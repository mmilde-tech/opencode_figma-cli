import { tool } from '@opencode-ai/plugin';
import { spawn } from 'child_process';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Buffer } from 'buffer';
import { homedir } from 'os';
import { FigmaClient, getConfiguredCdpPort, closeSharedFigmaTransport } from './core/figma-client.js';
import { resolveNodeExecutable } from './core/node-exec.js';
import * as ops from './core/operations.js';
import { rebuildComponentSet, inputRecipe, buttonRecipe, cardRecipe, badgeRecipe, heroRecipe, applyTokens } from './core/recipes.js';
import { validateComponentSet } from './core/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', 'bin', 'opencode-figma');
const SETTINGS_DIR = join(homedir(), '.opencode-figma');
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json');

/** default | compact — only input/button recipes use this today. */
function normalizeRecipePreset(p) {
  return String(p || 'default').toLowerCase().trim() === 'compact' ? 'compact' : 'default';
}

/** Block models from answering with Figma tutorials instead of invoking tools (common GPT failure mode). */
const FORBIDDEN_MANUAL_UI =
  'FORBIDDEN: Do not give step-by-step Figma desktop tutorials ("create frames", "duplicate", "open menu…"). The USER does not manually build inputs/buttons—you must CALL a figma_* tool in your turn and place real nodes/components.';

/** Prepended to core tool descriptions so the model never asks users to memorize CLI/tool names. */
const NL = [
  FORBIDDEN_MANUAL_UI,
  'End users talk in natural language only.',
  'You must pick figma_* tools yourself — never tell users to run opencode-figma or memorize tool IDs.',
  'The first successful figma_* call auto-runs local CDP setup when needed.'
].join(' ');

function isRecoverableFigmaBootstrapError(message) {
  const m = String(message || '');
  return (
    m.includes('No saved CDP port') ||
    m.includes('No Figma file open') ||
    m.includes('Not connected') ||
    m.includes('Connection timeout') ||
    m.includes('WebSocket failed')
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// One FigmaClient instance per plugin lifetime; reused across tool calls so
// we don't reconnect for every command.
let _client = null;
let _pending = null;
let _ctxCache = { at: 0, value: null };
let _settingsCache = { at: 0, value: null };

async function getClient() {
  if (_client) return _client;
  if (_pending) return _pending;
  _pending = (async () => {
    const connectOnce = async () => {
      const c = new FigmaClient();
      await c.connect();
      return c;
    };

    try {
      const c = await connectOnce();
      _client = c;
      _pending = null;
      return c;
    } catch (firstErr) {
      const msg = firstErr?.message || String(firstErr);
      if (!isRecoverableFigmaBootstrapError(msg)) {
        _pending = null;
        throw firstErr;
      }

      invalidateFigmaClient({ clearPending: false });
      try {
        await runCLI(['connect'], { timeout: 180000 });
      } catch (cliErr) {
        _pending = null;
        const hint = cliErr?.message || String(cliErr);
        throw new Error(
          `Figma is not reachable yet (${hint}). Open Figma Desktop, open any design file tab, then retry in natural language — the user should not run manual connect commands.`
        );
      }

      invalidateFigmaClient({ clearPending: false });
      try {
        const c = await connectOnce();
        _client = c;
        _pending = null;
        return c;
      } catch (secondErr) {
        _pending = null;
        const m2 = secondErr?.message || String(secondErr);
        throw new Error(
          `${m2} Open a canvas document in Figma (not only the home screen), then try again.`
        );
      }
    }
  })();
  return _pending;
}

/** Drop cached WebSocket — required after `connect` restarts Figma or when forcing reconnect. */
function invalidateFigmaClient({ clearPending = true } = {}) {
  if (_client) {
    try { _client.close(); } catch {}
    _client = null;
  } else {
    try { closeSharedFigmaTransport(); } catch {}
  }
  if (clearPending) _pending = null;
  _ctxCache = { at: 0, value: null };
}

function readSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return { strict: false };
    const json = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    // Opt-in: strict targeting only when settings.json has "strict": true
    return { strict: json.strict === true };
  } catch {
    return { strict: false };
  }
}

function writeSettings(next) {
  try { mkdirSync(SETTINGS_DIR, { recursive: true }); } catch {}
  const toWrite = { strict: Boolean(next?.strict) };
  writeFileSync(SETTINGS_FILE, JSON.stringify(toWrite, null, 2), 'utf8');
  _settingsCache = { at: Date.now(), value: toWrite };
}

function getSettings({ ttlMs = 1000 } = {}) {
  const now = Date.now();
  if (_settingsCache.value && (now - _settingsCache.at) < ttlMs) return _settingsCache.value;
  const v = readSettings();
  _settingsCache = { at: now, value: v };
  return v;
}

async function getContextSnapshot({ ttlMs = 800 } = {}) {
  const now = Date.now();
  if (_ctxCache.value && (now - _ctxCache.at) < ttlMs) return _ctxCache.value;
  const c = await getClient();
  const port = getConfiguredCdpPort();
  const info = await ops.canvasInfo(c);
  const comps = await ops.listComponents(c);
  const value = { port, info, comps };
  _ctxCache = { at: now, value };
  return value;
}

function formatSelection(sel, max = 10) {
  if (!Array.isArray(sel) || sel.length === 0) return '(none)';
  const lines = sel.slice(0, max).map(n => `  - ${n.type} ${n.name} (${n.id})`);
  if (sel.length > max) lines.push(`  - ... and ${sel.length - max} more`);
  return lines.join('\n');
}

/**
 * Stability-first guard for tools that mutate a single target node by default.
 * If nodeId/nodeIds are missing, require an unambiguous selection.
 */
async function requireTarget({ nodeId, nodeIds, allowMulti = false } = {}) {
  const { strict } = getSettings();
  if (strict) {
    // In strict mode, selection is never an implicit target.
    if (!nodeId && !(Array.isArray(nodeIds) && nodeIds.length)) {
      throw new Error(
        'Strict Mode: pass `nodeId` / `nodeIds` explicitly (selection is not used implicitly). ' +
          'Or disable: `figma_settings` action=set strict=false'
      );
    }
    return;
  }
  if (nodeId || (Array.isArray(nodeIds) && nodeIds.length)) return;
  const { info } = await getContextSnapshot({ ttlMs: 500 });
  const sel = info.selectionDetails || [];
  if (sel.length === 0) {
    throw new Error('No node selected and no nodeId provided.\n\nSelection:\n' + formatSelection(sel));
  }
  if (!allowMulti && sel.length !== 1) {
    throw new Error(
      `Selection is ambiguous (${sel.length} nodes). Pass nodeId/nodeIds explicitly.\n\nSelection:\n` +
        formatSelection(sel)
    );
  }
}

// Wrap a tool body so any thrown error becomes a clean Error message back to
// OpenCode (no stack noise, but include the operation name).
function withErrorContext(opName, fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      const msg = e?.message || String(e);
      const hints = [];

      // Common "user action required" cases. Keep these short and actionable.
      if (msg.includes('No Figma file open') || msg.includes('Could not find Figma plugin context')) {
        hints.push('Open a Figma design file tab (not just Home/Recents), then run `figma_connect` again.');
      }
      if (msg.includes('No node selected') || msg.includes('no node selected')) {
        hints.push('Select a node in Figma or pass `nodeId`/`nodeIds` explicitly.');
      }
      if (msg.includes('Not connected')) {
        hints.push('Open Figma with a design file, then retry the same request (the plugin connects automatically).');
      }
      if (msg.includes('Command timeout')) {
        hints.push('Figma may be busy; retry the command. If it persists, run `figma_connect` with forceRestart=true.');
      }

      const suffix = hints.length ? `\n\nHints:\n- ${hints.join('\n- ')}` : '';
      throw new Error(`${opName}: ${msg}${suffix}`);
    }
  };
}

function runCLI(args, { timeout = 60000 } = {}) {
  // Always invoke the CLI via the running node binary so we don't depend on
  // shebang interpretation (which doesn't exist on Windows).
  return new Promise((resolveOk, rejectErr) => {
    const child = spawn(resolveNodeExecutable(), [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      windowsHide: true
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolveOk(out.trim());
      else rejectErr(new Error((err || out).trim() || `CLI exited ${code}`));
    });
    child.on('error', rejectErr);
  });
}

// Format a list of nodes for return to the AI. Concise but with ids so the AI
// can reference them in subsequent tool calls.
function fmtNodes(nodes, max = 25) {
  if (!Array.isArray(nodes) || !nodes.length) return '(none)';
  const lines = nodes.slice(0, max).map(n =>
    `  ${n.type} ${n.name} (${n.id})${n.width != null ? ` ${Math.round(n.width)}×${Math.round(n.height)}` : ''}`
  );
  if (nodes.length > max) lines.push(`  ... and ${nodes.length - max} more`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const OpenCodeFigmaPlugin = async () => {
  return {
    name: 'opencode-figma',
    version: '1.2.3',

    'experimental.chat.system.transform': async (_input, output) => {
      if (!output.system) output.system = [];
      if (Array.isArray(output.system)) {
        output.system.push(
          'opencode-figma: HARD RULE — If the user asks for an INPUT, BUTTON, or other UI in THEIR Figma file, you MUST call an automation tool (prefer figma_build kind=input|button, or figma_recipe recipe=input|button, or figma_component create-set) IN THE SAME TURN. It is NEVER correct to paste Figma manual instructions instead of invoking tools — that wastes the integration. Users use plain language only. First figma_* call auto-connects locally; only ask them to open a design file if connection fails. One-off screens/sections: figma_render.'
        );
      }
    },

    tool: {
      figma_connect: tool({
        description:
          'Optional manual connection or Figma restart. Normally you do NOT ask the user for this — any other figma_* tool auto-connects to local Figma Desktop (CDP). Use forceRestart=true if Figma/CDP is wedged. Not network access — local only.',
        args: {
          forceRestart: tool.schema.boolean().optional().describe('Quit and restart Figma to refresh CDP.')
        },
        execute: withErrorContext('figma_connect', async (args) => {
          const forceRestart = Boolean(args.forceRestart);

          if (!forceRestart && await FigmaClient.isConnected()) {
            invalidateFigmaClient();
            try {
              const c = new FigmaClient();
              await c.connect();
              _client = c;
              const port = getConfiguredCdpPort();
              return `Already connected — CDP port ${port}. No Figma restart; you can use figma_* tools now.`;
            } catch {
              invalidateFigmaClient();
              // stale port or socket — fall through to full CLI connect
            }
          }

          const cliArgs = ['connect'];
          if (forceRestart) cliArgs.push('--force-restart');
          // connect polls up to ~92s cold-start plus daemon wait; Shell/OpenCode buffers ora — use ample timeout
          await runCLI(cliArgs, { timeout: 180000 });
          invalidateFigmaClient();
          const port = getConfiguredCdpPort();
          return port
            ? `Connected via Yolo Mode (CDP port ${port}). Figma was restarted if needed — next figma_* call opens a fresh session.`
            : 'Connected via Yolo Mode. Run figma_canvas or another tool to verify.';
        })
      }),

      figma_settings: tool({
        description:
          'Get or set plugin targeting. Default strict=false: mutating tools may use the current Figma selection when nodeId is omitted (single selection required). Set strict=true to force explicit nodeId/nodeIds only (stricter, can block agents).',
        args: {
          action: tool.schema.string().optional().describe('get | set'),
          strict: tool.schema.boolean().optional().describe('When true, mutating tools require nodeId/nodeIds (no implicit selection).')
        },
        execute: withErrorContext('figma_settings', async (args) => {
          const action = String(args.action || 'get').toLowerCase();
          if (action === 'get') {
            const s = getSettings({ ttlMs: 0 });
            return `Settings:\n- strict: ${s.strict ? 'true' : 'false'}\nFile: ${SETTINGS_FILE}`;
          }
          if (action === 'set') {
            const cur = getSettings({ ttlMs: 0 });
            if (typeof args.strict !== 'boolean') {
              throw new Error('action=set requires strict=true or strict=false');
            }
            const next = { strict: args.strict };
            writeSettings(next);
            return `Settings updated:\n- strict: ${next.strict ? 'true' : 'false'} (was ${cur.strict ? 'true' : 'false'})`;
          }
          throw new Error('Unknown action: use get | set');
        })
      }),

      figma_create: tool({
        description: 'Create a single primitive Figma node (frame, text, rect, ellipse). For multi-node layouts use figma_render with JSX. For reusable UI elements (buttons, cards, badges) use figma_component with action="create-set" instead — never create the same component twice. Set action="to-component" + nodeIds[] to convert existing nodes to components.',
        args: {
          type: tool.schema.string().optional().describe('frame | text | rect | circle | ellipse | line | star | polygon | icon'),
          name: tool.schema.string().optional(),
          content: tool.schema.string().optional().describe('Text content (when type=text)'),
          width: tool.schema.number().optional(),
          height: tool.schema.number().optional(),
          fill: tool.schema.string().optional().describe('Hex (#abcdef) or var:name (e.g. var:primary)'),
          stroke: tool.schema.string().optional(),
          strokeWidth: tool.schema.number().optional(),
          rounded: tool.schema.number().optional().describe('Corner radius'),
          icon: tool.schema.string().optional(),
          action: tool.schema.string().optional().describe('Set to "to-component" to convert existing nodes'),
          nodeId: tool.schema.string().optional(),
          nodeIds: tool.schema.array(tool.schema.string()).optional()
        },
        execute: withErrorContext('figma_create', async (args) => {
          const c = await getClient();
          if (args.action === 'to-component') {
            await requireTarget({ nodeId: args.nodeId, nodeIds: args.nodeIds, allowMulti: true });
            const out = await ops.toComponent(c, args);
            return `Converted ${out.length} node(s) to components:\n${fmtNodes(out)}`;
          }
          if (!args.type) throw new Error('type is required (frame, text, rect, circle, etc.)');
          const out = await ops.createNode(c, args);
          return `Created ${out.type} "${out.name}" (${out.id})`;
        })
      }),

      figma_set: tool({
        description:
          'Set a node property. COLORS: fill, stroke — value hex or var:… (COLOR token). FLOAT tokens (spacing, radius, etc.): gap/paddingLeft/paddingRight/paddingTop/paddingBottom/paddingleft aliases, strokeWidth, radius, opacity, fontSize, letterSpacing, lineHeight, counterAxisSpacing, width, height — number or var:… (FLOAT token; uses setBoundVariable). Also x, y, name, visible.',
        args: {
          property: tool.schema.string(),
          value: tool.schema.string(),
          nodeId: tool.schema.string().optional()
        },
        execute: withErrorContext('figma_set', async (args) => {
          const c = await getClient();
          await requireTarget({ nodeId: args.nodeId });
          const out = await ops.setProperty(c, args);
          return `Set ${args.property} = ${args.value} on ${out.type} "${out.name}" (${out.id})`;
        })
      }),

      figma_tokens: tool({
        description: 'Add design tokens. preset = "shadcn" (32 semantic vars × Light/Dark), "tailwind" (242 colors), or "ds" (small starter palette). Set action="visualize" to draw a swatch board on the canvas.',
        args: {
          preset: tool.schema.string().optional(),
          action: tool.schema.string().optional().describe('"visualize" to render swatches'),
          filter: tool.schema.string().optional()
        },
        execute: withErrorContext('figma_tokens', async (args) => {
          const c = await getClient();
          if (args.action === 'visualize') {
            const r = await ops.visualizeTokens(c, { collection: args.filter });
            return `Rendered swatch board with ${r.count} variable(s) → "${r.name}" (${r.id})`;
          }
          if (!args.preset) throw new Error('preset is required (shadcn | tailwind | ds), or pass action="visualize"');
          const r = await ops.addPreset(c, args);
          return `Added ${r.preset} tokens: ${r.variables} variable(s) in 1 collection.`;
        })
      }),

      figma_render: tool({
        description: [
          FORBIDDEN_MANUAL_UI,
          'Render JSX into Figma for one-off compositions (screens, heroes, sections). Do NOT use this as an excuse to tell the user to build inputs/buttons by hand — for those use figma_build or figma_recipe.',
          'NEVER use Terminal/Shell pipelines (create blank frames → find → convert) for Buttons/Inputs.',
          'Tags:',
          '  • Frame / Stack / VStack / HStack / Row / Column — auto-layout containers',
          '  • Text / H1 / H2 / H3 / H4 / Label — text nodes (size/weight/color)',
          '  • Rect / Ellipse — shapes',
          '  • Instance — place an existing component or component set (component="Button", variant="State=Hover, Size=Lg", and any other prop becomes a text override matched by node name).',
          'Layout props (frames with flex/HStack/VStack): wrap + rowGap|crossGap (wrapped rows/columns), justify, items, gap, padding props as before.',
          'Child-in-stack props (apply inside auto-layout parent): grow (number or true=1), alignSelf (start|center|end|stretch|baseline), minW maxW minH maxH.',
          'Props: name, w/h (number, or "fill"/"hug"), bg/fill, stroke/strokeWidth, rounded, opacity, flex ("row"/"col"), gap, p/px/py/pl/pr/pt/pb, justify ("start"/"center"/"end"/"between"), items, color (Text), size (Text), weight (Text).',
          'Examples:',
          '  Toolbar: <HStack w={400} justify="between" items="center" gap={12} p={16}><Text>Logo</Text><Text>Menu</Text></HStack>',
          '  Fill remainder: <HStack w={480}><Text>Fixed</Text><Frame grow={1} bg="#EEE" h={40}/></HStack>',
          '  Wrap chips: <HStack flex="row" wrap gap={8} rowGap={8} w={320}><Text>Tag A</Text><Text>Tag B</Text></HStack>',
          'Variables: COLOR — bg/fill/stroke/color use var:Collection/name. FLOAT — gap, rowGap/crossGap, p/px/py/…, rounded, strokeWidth, opacity, Text size use number or var:… for FLOAT tokens (setBoundVariable).',
          'Batch render multiple roots: [<A/>, <B/>].',
          'IMPORTANT: Reusable UI (Button/Input/Card/Badge…): use figma_recipe (recipe=button|input) OR figma_component action=create-set — never create separate components named "X Default/Hover/Disabled". When consuming in a layout, use <Instance component="Button"/>, never raw duplicate frames.'
        ].join('\n'),
        args: {
          jsx: tool.schema.string()
        },
        execute: withErrorContext('figma_render', async (args) => {
          const c = await getClient();
          const out = await ops.renderJSX(c, args.jsx);
          return `Rendered ${out.length} node(s):\n${fmtNodes(out)}`;
        })
      }),

      figma_component: tool({
        description: [
          NL,
          'Create and use Figma components. ALWAYS use this (not figma_render, not figma_create except primitives) when building reusable UI elements (Button, Card, Input, Badge, Tag, Avatar, etc.).',
          'OpenCode routing: If the user asks for a Button/Input with states, prefer figma_recipe recipe=button|input first (deterministic), otherwise figma_component action=create-set. Do NOT use Shell to script create/find/convert/render for these.',
          'actions:',
          '  • create — single component from JSX. args: name, jsx.',
          '  • create-set — variant set (one component with multiple states/sizes). args: name, variants: [{ properties:{State:"Default"}, jsx:"<Frame .../>" }, { properties:{State:"Hover"}, jsx:"<Frame .../>" }]. Variant frames are named "State=Default, Size=Lg" so Figma exposes those as variant properties.',
          '  • instance — place an instance of a component. args: component (name or id), variant ("State=Hover, Size=Lg"), overrides ({ Label:"Click me" } — matches text nodes by name).',
          '  • list — list every component / component-set in the document.',
          '  • delete — remove components by ids.',
          'IMPORTANT: A component name must be unique. Never create "Button 1", "Button 2"; use one Button component-set with State variants. Then use <Instance component="Button" variant="State=Hover"/> inside layouts.'
        ].join('\n'),
        args: {
          action: tool.schema.string(),
          name: tool.schema.string().optional(),
          jsx: tool.schema.string().optional(),
          variants: tool.schema.array(tool.schema.object({
            properties: tool.schema.object({}).optional(),
            jsx: tool.schema.string()
          })).optional(),
          component: tool.schema.string().optional(),
          variant: tool.schema.string().optional(),
          overrides: tool.schema.object({}).optional(),
          nodeIds: tool.schema.array(tool.schema.string()).optional()
        },
        execute: withErrorContext('figma_component', async (args) => {
          const c = await getClient();
          const a = String(args.action || '').toLowerCase();
          if (a === 'create') {
            if (!args.jsx) throw new Error('jsx is required for action=create');
            const r = await ops.createComponent(c, args);
            return `Created component "${r.name}" (${r.id}).`;
          }
          if (a === 'create-set' || a === 'createset' || a === 'set') {
            const r = await ops.createComponentSet(c, args);
            return `Created component set "${r.name}" (${r.id}) with ${r.variants.length} variant(s):\n` +
              r.variants.map(v => `  ${v.name} (${v.id})`).join('\n');
          }
          if (a === 'instance') {
            const r = await ops.createInstance(c, args);
            return `Placed instance "${r.name}" (${r.id}).`;
          }
          if (a === 'list') {
            const r = await ops.listComponents(c);
            if (!r.length) return 'No components in document.';
            return r.map(co => {
              const head = `${co.type === 'COMPONENT_SET' ? 'SET' : 'COMP'} ${co.name} (${co.id})`;
              if (!co.variants.length) return head;
              return head + '\n' + co.variants.map(v => `  → ${v.name} (${v.id})`).join('\n');
            }).join('\n');
          }
          if (a === 'delete') {
            await requireTarget({ nodeIds: args.nodeIds, allowMulti: true });
            const r = await ops.deleteNodes(c, { nodeIds: args.nodeIds });
            return `Removed ${r.removed} component node(s).`;
          }
          throw new Error('Unknown component action: ' + args.action + ' (use create | create-set | instance | list | delete)');
        })
      }),

      figma_textstyle: tool({
        description: 'Manage shared text styles (Heading, Body, Caption, etc.). action = list | create. Create takes name, family ("Inter"), style ("Bold"/"Medium"/"Regular"), size, lineHeight ("24" / "150%" / "auto"), letterSpacing.',
        args: {
          action: tool.schema.string(),
          name: tool.schema.string().optional(),
          family: tool.schema.string().optional(),
          style: tool.schema.string().optional(),
          size: tool.schema.number().optional(),
          lineHeight: tool.schema.string().optional(),
          letterSpacing: tool.schema.number().optional()
        },
        execute: withErrorContext('figma_textstyle', async (args) => {
          const c = await getClient();
          const a = String(args.action || '').toLowerCase();
          if (a === 'list') {
            const r = await ops.listTextStyles(c);
            if (!r.length) return 'No text styles.';
            return r.map(s => `  ${s.name}  ${s.fontFamily} ${s.fontStyle} ${s.fontSize}px / lh ${s.lineHeight}`).join('\n');
          }
          if (a === 'create') {
            const r = await ops.createTextStyle(c, args);
            return `Created text style "${r.name}" (${r.id}).`;
          }
          throw new Error('Unknown action: use list | create');
        })
      }),

      figma_effect: tool({
        description: 'Manage shared effect styles (drop shadows, blurs). action = list | create. Create takes name, type ("shadow" | "inner" | "blur" | "background-blur"), color, opacity, x, y, blur, spread.',
        args: {
          action: tool.schema.string(),
          name: tool.schema.string().optional(),
          type: tool.schema.string().optional(),
          color: tool.schema.string().optional(),
          opacity: tool.schema.number().optional(),
          x: tool.schema.number().optional(),
          y: tool.schema.number().optional(),
          blur: tool.schema.number().optional(),
          spread: tool.schema.number().optional()
        },
        execute: withErrorContext('figma_effect', async (args) => {
          const c = await getClient();
          const a = String(args.action || '').toLowerCase();
          if (a === 'list') {
            const r = await ops.listEffectStyles(c);
            return r.length ? r.map(s => `  ${s.name}  (${s.effects} effect${s.effects === 1 ? '' : 's'})`).join('\n') : 'No effect styles.';
          }
          if (a === 'create') {
            const r = await ops.createEffectStyle(c, args);
            return `Created effect style "${r.name}" (${r.id}).`;
          }
          throw new Error('Unknown action: use list | create');
        })
      }),

      figma_layout: tool({
        description: 'Set layout sizing on existing nodes inside auto-layout containers. horizontal/vertical = "FILL" | "HUG" | "FIXED". Use this when a child needs to stretch to the parent\'s width or shrink to fit its content.',
        args: {
          horizontal: tool.schema.string().optional(),
          vertical: tool.schema.string().optional(),
          nodeId: tool.schema.string().optional(),
          nodeIds: tool.schema.array(tool.schema.string()).optional()
        },
        execute: withErrorContext('figma_layout', async (args) => {
          const c = await getClient();
          await requireTarget({ nodeId: args.nodeId, nodeIds: args.nodeIds, allowMulti: true });
          const r = await ops.setLayoutSizing(c, args);
          return `Layout sizing applied to ${r.applied} node(s).`;
        })
      }),

      figma_export: tool({
        description: 'Export a node to a file on disk. Returns the absolute output path. format: png | jpg | svg | pdf.',
        args: {
          format: tool.schema.string(),
          nodeId: tool.schema.string().optional(),
          scale: tool.schema.number().optional(),
          output: tool.schema.string().optional().describe('Output file path (defaults to <node-name>.<ext> in cwd)')
        },
        execute: withErrorContext('figma_export', async (args) => {
          const c = await getClient();
          await requireTarget({ nodeId: args.nodeId });
          const r = await ops.exportNode(c, args);
          const out = resolve(args.output || `${(r.name || 'export').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)}.${r.ext}`);
          if (r.encoding === 'base64') writeFileSync(out, Buffer.from(r.payload, 'base64'));
          else writeFileSync(out, r.payload, 'utf8');
          return `Exported ${args.format.toUpperCase()} → ${out}`;
        })
      }),

      figma_screenshot: tool({
        description: 'Screenshot a node as PNG @2x. Returns the saved file path. Equivalent to figma_export with format=png and scale=2.',
        args: {
          nodeId: tool.schema.string().optional(),
          output: tool.schema.string().optional()
        },
        execute: withErrorContext('figma_screenshot', async (args) => {
          const c = await getClient();
          await requireTarget({ nodeId: args.nodeId });
          const r = await ops.exportNode(c, { format: 'png', nodeId: args.nodeId, scale: 2 });
          const out = resolve(args.output || `${(r.name || 'screenshot').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)}.png`);
          writeFileSync(out, Buffer.from(r.payload, 'base64'));
          return `Saved screenshot → ${out}`;
        })
      }),

      figma_analyze: tool({
        description: 'Analyze the page or a node. type: "colors" (unique solids + frequency) | "typography" (font/size frequencies) | "spacing" (paddings + auto-layout gaps) | "canvas" (top-level summary).',
        args: {
          type: tool.schema.string(),
          nodeId: tool.schema.string().optional()
        },
        execute: withErrorContext('figma_analyze', async (args) => {
          const c = await getClient();
          const t = String(args.type || '').toLowerCase();
          if (t === 'colors') {
            const r = await ops.analyzeColors(c, args);
            if (!r.length) return 'No solid colors on this page.';
            return r.map(({ hex, count }) => `${hex.padEnd(8)} × ${count}`).join('\n');
          }
          if (t === 'typography') {
            const r = await ops.analyzeTypography(c, args);
            if (!r.length) return 'No text nodes on this page.';
            return r.map(({ font, count }) => `${font} × ${count}`).join('\n');
          }
          if (t === 'spacing') {
            const r = await ops.analyzeSpacing(c, args);
            return [
              'Paddings:',
              ...(r.paddings.length ? r.paddings.map(({ px, count }) => `  ${px}px × ${count}`) : ['  (none)']),
              'Auto-layout gaps:',
              ...(r.gaps.length ? r.gaps.map(({ px, count }) => `  ${px}px × ${count}`) : ['  (none)'])
            ].join('\n');
          }
          if (t === 'canvas') {
            const info = await ops.canvasInfo(c);
            return `Page "${info.page}" — ${info.children} top-level node(s), ${info.selection} selected, zoom ${info.viewport.zoom.toFixed(2)}.`;
          }
          throw new Error(`Unknown analyze type "${args.type}". Use: colors | typography | spacing | canvas`);
        })
      }),

      figma_lint: tool({
        description:
          'Run accessibility / design lints. Omit rule to run: color-contrast, touch-target-size, no-default-names. Use rule=layout-grid alone to flag auto-layout gap/padding not on 4px steps (opt-in; noisy on mixed files).',
        args: {
          rule: tool.schema.string().optional(),
          nodeId: tool.schema.string().optional()
        },
        execute: withErrorContext('figma_lint', async (args) => {
          const c = await getClient();
          const issues = await ops.lint(c, args);
          if (!issues.length) return 'No lint issues.';
          const byRule = {};
          for (const it of issues) (byRule[it.rule] = byRule[it.rule] || []).push(it);
          const lines = [`${issues.length} issue(s):`];
          for (const [r, list] of Object.entries(byRule)) {
            lines.push(`\n${r} (${list.length}):`);
            for (const it of list.slice(0, 20)) {
              lines.push(`  ${it.msg}`);
              lines.push(`    ${it.node.type} ${it.node.name} (${it.node.id})`);
            }
            if (list.length > 20) lines.push(`  ... and ${list.length - 20} more`);
          }
          return lines.join('\n');
        })
      }),

      figma_find: tool({
        description: 'Find nodes by name pattern (* wildcard supported). Returns node ids you can pass to other tools.',
        args: {
          pattern: tool.schema.string(),
          type: tool.schema.string().optional().describe('FRAME | TEXT | COMPONENT | INSTANCE | RECTANGLE | ELLIPSE | etc.')
        },
        execute: withErrorContext('figma_find', async (args) => {
          const c = await getClient();
          const out = await ops.findNodes(c, args);
          if (!out.length) return `No nodes match "${args.pattern}"${args.type ? ` (type=${args.type})` : ''}.`;
          return `Found ${out.length} node(s):\n${fmtNodes(out)}`;
        })
      }),

      figma_variable: tool({
        description: 'Manage variables. action = list | create | find | delete-all | visualize. For create: name, collection, type (COLOR/FLOAT/STRING/BOOLEAN), value.',
        args: {
          action: tool.schema.string(),
          name: tool.schema.string().optional(),
          collection: tool.schema.string().optional(),
          type: tool.schema.string().optional(),
          value: tool.schema.string().optional()
        },
        execute: withErrorContext('figma_variable', async (args) => {
          const c = await getClient();
          const a = String(args.action || '').toLowerCase();
          if (a === 'list') {
            const r = await ops.listVariables(c, args);
            if (!r.length) return `No variables${args.collection ? ` in "${args.collection}"` : ''}.`;
            return `${r.length} variable(s):\n` + r.map(v => `  ${v.collection} / ${v.name} (${v.type})`).join('\n');
          }
          if (a === 'find') {
            const r = await ops.findVariables(c, args);
            if (!r.length) return 'No matches.';
            return r.map(v => `  ${v.collection} / ${v.name} (${v.type})`).join('\n');
          }
          if (a === 'create') {
            const r = await ops.createVariable(c, args);
            return `Created ${r.type} variable "${r.name}" in "${r.collection}".`;
          }
          if (a === 'delete-all') {
            const r = await ops.deleteAllVariables(c, args);
            return `Deleted ${r.collections} collection(s) and ${r.variables} variable(s).`;
          }
          if (a === 'visualize') {
            const r = await ops.visualizeTokens(c, { collection: args.collection });
            return `Rendered swatch board with ${r.count} variable(s) → "${r.name}" (${r.id}).`;
          }
          throw new Error(`Unknown action "${args.action}". Use: list | create | find | delete-all | visualize`);
        })
      }),

      figma_collection: tool({
        description: 'Manage variable collections. action = list | create | delete.',
        args: {
          action: tool.schema.string(),
          name: tool.schema.string().optional()
        },
        execute: withErrorContext('figma_collection', async (args) => {
          const c = await getClient();
          const a = String(args.action || '').toLowerCase();
          if (a === 'list') {
            const r = await ops.listCollections(c);
            if (!r.length) return 'No collections.';
            return r.map(co => `  ${co.name}  modes: ${co.modes.join(', ')}`).join('\n');
          }
          if (a === 'create') {
            const r = await ops.ensureCollection(c, args);
            return `Collection "${r.name}" ready (modes: ${r.modes.join(', ')}).`;
          }
          if (a === 'delete') {
            const r = await ops.deleteCollection(c, args);
            return `Deleted ${r.removed} collection(s).`;
          }
          throw new Error(`Unknown action "${args.action}". Use: list | create | delete`);
        })
      }),

      figma_canvas: tool({
        description: 'Canvas operations. action = info | list | arrange | zoom-fit | clear. arrange takes layout = "grid" | "row" | "column".',
        args: {
          action: tool.schema.string(),
          layout: tool.schema.string().optional(),
          nodeIds: tool.schema.array(tool.schema.string()).optional().describe('Explicit node ids for arrange/zoom-fit/clear (recommended in Strict Mode)')
        },
        execute: withErrorContext('figma_canvas', async (args) => {
          const c = await getClient();
          const a = String(args.action || '').toLowerCase();
          if (a === 'info') {
            const i = await ops.canvasInfo(c);
            const lines = [
              `Page: ${i.page}`,
              `Top-level nodes: ${i.children}`,
              `Selected: ${i.selection}`,
              `Zoom: ${i.viewport.zoom.toFixed(2)}`
            ];
            if (i.selectionDetails.length) {
              lines.push('Selection:');
              for (const n of i.selectionDetails) lines.push(`  ${n.type} ${n.name} (${n.id})`);
            }
            return lines.join('\n');
          }
          if (a === 'list') {
            const nodes = await ops.canvasList(c);
            if (!nodes.length) return 'No nodes on canvas.';
            return `${nodes.length} top-level node(s):\n${fmtNodes(nodes)}`;
          }
          if (a === 'arrange') {
            await requireTarget({ nodeIds: args.nodeIds, allowMulti: true });
            const r = await ops.canvasArrange(c, { layout: args.layout || 'grid', nodeIds: args.nodeIds });
            return `Arranged ${r.count} node(s) in ${r.layout}.`;
          }
          if (a === 'zoom-fit' || a === 'zoom') {
            await requireTarget({ nodeIds: args.nodeIds, allowMulti: true });
            const r = await ops.canvasZoomTo(c, { nodeIds: args.nodeIds });
            return `Zoomed to fit ${r.count} node(s).`;
          }
          if (a === 'clear') {
            await requireTarget({ nodeIds: args.nodeIds, allowMulti: true });
            const r = await ops.canvasClear(c, { nodeIds: args.nodeIds });
            return `Removed ${r.removed} node(s).`;
          }
          throw new Error(`Unknown canvas action "${args.action}". Use: info | list | arrange | zoom-fit | clear`);
        })
      }),

      figma_eval: tool({
        description: 'Run raw Figma Plugin API code. Has access to figma.* and _oc.* helpers. Code can be a single expression ("figma.currentPage.name") or a statement block ("const x = await figma.foo(); return x;").',
        args: {
          code: tool.schema.string()
        },
        execute: withErrorContext('figma_eval', async (args) => {
          const c = await getClient();
          const r = await c.run(args.code);
          if (r === undefined || r === null) return 'Executed (no return value).';
          return typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r);
        })
      }),

      figma_daemon: tool({
        description: 'Speed daemon control. action = start | stop | restart | status. The daemon is optional — most tools work without it.',
        args: {
          action: tool.schema.string()
        },
        execute: withErrorContext('figma_daemon', async (args) => {
          return await runCLI(['daemon', args.action]);
        })
      }),

      figma_build: tool({
        description: [
          FORBIDDEN_MANUAL_UI,
          'Use when the user asks you to CREATE / BUILD UI in their file. One call = deterministic component set on canvas.',
          'Do not describe how THEY should click in Figma — you run this tool. Same automation as figma_recipe.',
          'kind: input | button | card | badge | hero (aliases: text field → input; marketing hero → hero).',
          'Optional preset=compact for input|button only (tighter spacing; default leaves current sizes).'
        ].join('\n'),
        args: {
          kind: tool.schema.string().describe('input | button | card | badge | hero'),
          preset: tool.schema.string().optional().describe('default | compact (input and button only)')
        },
        execute: withErrorContext('figma_build', async (args) => {
          const c = await getClient();
          const kind = String(args.kind || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ');
          const preset = normalizeRecipePreset(args.preset);
          const isInput = kind === 'input' || kind === 'text field' || kind === 'textfield' || kind === 'text-field';
          if (isInput) {
            const r = await rebuildComponentSet(c, inputRecipe({ preset }));
            return `Built Input set "${r.name}" (${r.id}) — ${r.variants.length} variants on canvas. Summarize that for the user; do not add manual Figma UI steps.`;
          }
          if (kind === 'button') {
            const r = await rebuildComponentSet(c, buttonRecipe({ preset }));
            return `Built Button set "${r.name}" (${r.id}) — ${r.variants.length} variant(s). Summarize for the user; no manual steps.`;
          }
          if (kind === 'card') {
            const r = await rebuildComponentSet(c, cardRecipe({}));
            return `Built Card set "${r.name}" (${r.id}) — ${r.variants.length} variant(s).`;
          }
          if (kind === 'badge') {
            const r = await rebuildComponentSet(c, badgeRecipe({}));
            return `Built Badge set "${r.name}" (${r.id}) — ${r.variants.length} variant(s).`;
          }
          if (kind === 'hero' || kind === 'marketing hero' || kind === 'marketing-hero') {
            const r = await rebuildComponentSet(c, heroRecipe({}));
            return `Built Hero set "${r.name}" (${r.id}) — ${r.variants.length} variant(s).`;
          }
          throw new Error(
            'figma_build: kind must be input | button | card | badge | hero (got: ' + kind + ')'
          );
        })
      }),

      figma_recipe: tool({
        description: [
          NL,
          'Run a deterministic, idempotent recipe (high-level generator).',
          'Use this when you want stable results without the model improvising structure.',
          'OpenCode routing: Prefer figma_build OR this tool FIRST for Buttons/Inputs/Cards/Badges/Hero — never substitute Shell or human tutorials.',
          '',
          'recipe:',
          '  • "input" — Input set (9 variants). Optional preset=compact. strokeVar/bgVar/textVar.',
          '  • "button" — Button set (3 states). Optional preset=compact. buttonBgVar/buttonFgVar/buttonMutedBgVar/buttonMutedFgVar.',
          '  • "card" — Card component (Title, Description, Action text).',
          '  • "badge" — Badge set (Tone × Size, 4 variants).',
          '  • "hero" — Hero / marketing block (single layout variant, CTA row).',
          '  • "token-apply" — applies a token map to the selection (or nodeIds).',
          '',
          'action:',
          '  • "rebuild" (default) — deletes existing component set by name and recreates it deterministically.'
        ].join('\n'),
        args: {
          recipe: tool.schema.string().describe('input | button | card | badge | hero | token-apply'),
          action: tool.schema.string().optional().describe('rebuild (default)'),
          preset: tool.schema.string().optional().describe('default | compact (input and button only)'),
          strokeVar: tool.schema.string().optional().describe('Input recipe: stroke (default hex #CBD5E1; or var:name)'),
          bgVar: tool.schema.string().optional().describe('Input recipe: Default-state fill (default #FFFFFF; or var:name)'),
          textVar: tool.schema.string().optional().describe('Input recipe: Default-state placeholder text fill (default #475569; or var:name)'),
          buttonBgVar: tool.schema.string().optional().describe('Button bg (default #7C3AED or override)'),
          buttonFgVar: tool.schema.string().optional().describe('Button fg'),
          buttonMutedBgVar: tool.schema.string().optional().describe('Disabled bg'),
          buttonMutedFgVar: tool.schema.string().optional().describe('Disabled fg'),
          nodeIds: tool.schema.array(tool.schema.string()).optional().describe('For token-apply: explicit target node ids (defaults to current selection)'),
          tokens: tool.schema.object({}).optional().describe('For token-apply: token map (fill/bg/stroke/text, radius, gap, padding, opacity, fontSize, deep=true to recurse)')
        },
        execute: withErrorContext('figma_recipe', async (args) => {
          const c = await getClient();
          const recipe = String(args.recipe || '').toLowerCase();
          const action = String(args.action || 'rebuild').toLowerCase();
          const preset = normalizeRecipePreset(args.preset);

          if (recipe === 'input') {
            const spec = inputRecipe({
              strokeVar: args.strokeVar,
              bgVar: args.bgVar,
              textVar: args.textVar,
              preset
            });
            if (action !== 'rebuild') throw new Error('Unsupported action for input: ' + action);
            const r = await rebuildComponentSet(c, spec);
            return `Recipe "${recipe}" complete: rebuilt component set "${r.name}" with ${r.variants.length} variant(s).`;
          }
          if (recipe === 'button') {
            const spec = buttonRecipe({
              bgVar: args.buttonBgVar,
              fgVar: args.buttonFgVar,
              mutedBgVar: args.buttonMutedBgVar,
              mutedFgVar: args.buttonMutedFgVar,
              preset
            });
            if (action !== 'rebuild') throw new Error('Unsupported action for button: ' + action);
            const r = await rebuildComponentSet(c, spec);
            return `Recipe "${recipe}" complete: rebuilt component set "${r.name}" with ${r.variants.length} variant(s).`;
          }
          if (recipe === 'card') {
            if (action !== 'rebuild') throw new Error('Unsupported action for card: ' + action);
            const r = await rebuildComponentSet(c, cardRecipe({}));
            return `Recipe "${recipe}" complete: rebuilt component set "${r.name}" with ${r.variants.length} variant(s).`;
          }
          if (recipe === 'badge') {
            if (action !== 'rebuild') throw new Error('Unsupported action for badge: ' + action);
            const r = await rebuildComponentSet(c, badgeRecipe({}));
            return `Recipe "${recipe}" complete: rebuilt component set "${r.name}" with ${r.variants.length} variant(s).`;
          }
          if (recipe === 'hero') {
            if (action !== 'rebuild') throw new Error('Unsupported action for hero: ' + action);
            const r = await rebuildComponentSet(c, heroRecipe({}));
            return `Recipe "${recipe}" complete: rebuilt component set "${r.name}" with ${r.variants.length} variant(s).`;
          }
          if (recipe === 'token-apply' || recipe === 'tokens' || recipe === 'apply-tokens') {
            await requireTarget({ nodeIds: args.nodeIds, allowMulti: true });
            const r = await applyTokens(c, { nodeIds: args.nodeIds, tokens: args.tokens || {} });
            const changed = Array.isArray(r.changed) ? r.changed.length : 0;
            return `Recipe "${recipe}" complete: updated ${changed} node(s) (from ${r.selected} selected).`;
          }
          throw new Error('Unknown recipe: ' + args.recipe);
        })
      }),

      figma_validate: tool({
        description:
          'Validate a component set structure and variant completeness. Use after figma_recipe / figma_build for Input, Button, Card, Badge, Hero, etc. Returns actionable issues.',
        args: {
          type: tool.schema.string().describe('Validation type: component-set'),
          name: tool.schema.string().describe('Component set name to validate (e.g. Input)')
        },
        execute: withErrorContext('figma_validate', async (args) => {
          const c = await getClient();
          const t = String(args.type || '').toLowerCase();
          if (t !== 'component-set' && t !== 'componentset') throw new Error('Unknown validate type: ' + args.type);
          const r = await validateComponentSet(c, { name: args.name });
          if (r.ok) return `✓ Valid: ${args.name} (${r.variants} variant(s))`;
          return `Found ${r.issues.length} issue(s) in ${args.name}:\n` + r.issues.map(i => `- [${i.kind}] ${i.message}`).join('\n');
        })
      }),

      figma_context: tool({
        description: [
          'Return a small, structured snapshot of the current Figma context.',
          'Use this to reduce guessing and keep the model fast/stable.',
          'Includes: CDP port, page, selection, component count.'
        ].join('\n'),
        args: {},
        execute: withErrorContext('figma_context', async () => {
          const { port, info, comps } = await getContextSnapshot({ ttlMs: 800 });
          const sel = info.selectionDetails || [];
          const lines = [];
          lines.push(`CDP port: ${port || '(unknown)'}`);
          lines.push(`Page: ${info.page}`);
          lines.push(`Selection: ${sel.length}`);
          if (sel.length) {
            for (const n of sel.slice(0, 10)) lines.push(`  - ${n.type} ${n.name} (${n.id})`);
            if (sel.length > 10) lines.push(`  - ... and ${sel.length - 10} more`);
          }
          lines.push(`Components: ${comps.length}`);
          return lines.join('\n');
        })
      }),

      figma_preflight: tool({
        description: [
          'Stability-first health check. Use this before complex operations.',
          'Reports: CDP reachable, design tab open, daemon health, and selection summary.'
        ].join('\n'),
        args: {},
        execute: withErrorContext('figma_preflight', async () => {
          const port = getConfiguredCdpPort();
          const ok = await FigmaClient.isConnected();
          let design = false;
          let pages = 0;
          try {
            if (port) {
              const probe = await probeDesignSession(port, { timeout: 1500 });
              design = probe.ok;
              pages = Array.isArray(probe.pages) ? probe.pages.length : 0;
            }
          } catch {}

          let daemon = false;
          try {
            daemon = await runCLI(['daemon', 'status'], { timeout: 4000 }).then(() => true).catch(() => false);
          } catch {}

          let ctx = '';
          try {
            ctx = await (async () => {
              const c = await getClient();
              const info = await ops.canvasInfo(c);
              const sel = info.selectionDetails || [];
              return `Page: ${info.page}\nSelection: ${sel.length}`;
            })();
          } catch (e) {
            ctx = `Context: unavailable (${e?.message || e})`;
          }

          const lines = [];
          const { strict: strictTargeting } = getSettings({ ttlMs: 0 });
          lines.push(`Strict targeting (settings): ${strictTargeting ? 'on' : 'off'}`);
          lines.push(`CDP port: ${port || '(unknown)'}`);
          lines.push(`CDP reachable: ${ok ? 'yes' : 'no'}`);
          lines.push(`Design tab detected: ${design ? 'yes' : 'no'}${pages ? ` (targets: ${pages})` : ''}`);
          lines.push(`Daemon status: ${daemon ? 'ok' : 'unknown/unavailable'}`);
          lines.push(ctx);
          if (!ok) {
            lines.push('');
            lines.push('Next: open any Figma design file tab, then use any figma_* tool again (connection is automatic).');
          }
          return lines.join('\n');
        })
      })
    }
  };
};

export default OpenCodeFigmaPlugin;
