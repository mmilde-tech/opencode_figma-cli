// In-Figma runtime helpers.
// This file exports a single string `RUNTIME` that defines a `_oc` global
// inside the Figma plugin sandbox. Every CLI command can prepend this and
// then call `_oc.foo(...)` from its eval body.
//
// IMPORTANT: All code here runs inside Figma. It must use only the Figma
// Plugin API. No Node / no DOM.

// Bump RUNTIME_VERSION whenever helpers below change. The first line of the
// in-Figma snippet checks this so the cached `_oc` is rebuilt on update,
// instead of getting stale from a previous Figma session.
const RUNTIME_VERSION = 11;

export const RUNTIME = `
(globalThis._oc = (globalThis._oc && globalThis._oc.__v === ${RUNTIME_VERSION}) ? globalThis._oc : (() => {
  const hexToRgb = (hex) => {
    const h = String(hex).replace(/^#/, '');
    const v = h.length === 3
      ? h.split('').map(c => c + c).join('')
      : h.padEnd(6, '0').slice(0, 6);
    return {
      r: parseInt(v.slice(0, 2), 16) / 255,
      g: parseInt(v.slice(2, 4), 16) / 255,
      b: parseInt(v.slice(4, 6), 16) / 255
    };
  };

  const rgbToHex = ({ r, g, b }) => {
    const to = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
    return '#' + to(r) + to(g) + to(b);
  };

  // Resolve a color spec. Accepts:
  //   "#abcdef" / "#abc" / hex without #
  //   "var:name" or "var:Collection/name" (name may contain further slashes, e.g. color/primary)
  //   { r, g, b } object
  //   null/undefined -> returns null (caller decides default)
  const resolveColor = async (spec) => {
    if (spec == null) return null;
    if (typeof spec === 'object' && 'r' in spec) return { type: 'rgb', value: spec };
    if (typeof spec !== 'string') return null;

    if (spec.startsWith('var:')) {
      const ref = spec.slice(4);
      const v = await findVariable(ref, 'COLOR');
      if (!v) throw new Error('Variable not found: ' + ref);
      return { type: 'var', variable: v };
    }

    return { type: 'rgb', value: hexToRgb(spec) };
  };

  // Build a SOLID paint from a resolved color.
  const paint = (resolved) => {
    if (!resolved) return null;
    if (resolved.type === 'rgb') {
      return { type: 'SOLID', color: resolved.value };
    }
    // Variable bind. Need a base color — use the variable's current resolved value.
    const base = { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } };
    return figma.variables.setBoundVariableForPaint(base, 'color', resolved.variable);
  };

  // Apply a fill spec (string/object) to a node.
  const applyFill = async (node, spec) => {
    const resolved = await resolveColor(spec);
    if (!resolved) { node.fills = []; return; }
    node.fills = [paint(resolved)];
  };

  const applyStroke = async (node, spec, weight) => {
    const resolved = await resolveColor(spec);
    if (!resolved) { node.strokes = []; return; }
    node.strokes = [paint(resolved)];
    if (weight != null && weight !== '') await applyScalarBinding(node, 'strokeWeight', weight);
  };

  // Figma errors on "." in createVariable names (e.g. stroke-weight/1.5 → use 1_5).
  // NOTE: RUNTIME is built from a template literal; use /\\./g here so the string seen
  // by Figma is /\./g. A single /\. inside the outer template can become /./g (any char)
  // on newer Node, mangling every variable name into underscores.
  const sanitizeVariableName = (n) => String(n).replace(/\\./g, '_');

  // Only the FIRST "/" separates collection from variable name; the variable
  // name itself may contain slashes (e.g. semantic + color/primary).
  const findVariable = async (ref, type) => {
    ref = String(ref).trim();
    const all = await figma.variables.getLocalVariablesAsync(type);
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const trim = (s) => String(s).trim();
    const colMatch = (want) => {
      const w = trim(want);
      let c = cols.find((x) => x.name === w);
      if (c) return c;
      const wl = w.toLowerCase();
      return cols.find((x) => x.name.toLowerCase() === wl) || null;
    };
    const varInCol = (col, name) => {
      const n = trim(name);
      const ns = sanitizeVariableName(n);
      let v =
        all.find((x) => x.variableCollectionId === col.id && x.name === n) ||
        all.find((x) => x.variableCollectionId === col.id && x.name === ns) ||
        null;
      if (v) return v;
      const nl = n.toLowerCase();
      const nsl = ns.toLowerCase();
      return (
        all.find((x) => x.variableCollectionId === col.id && x.name.toLowerCase() === nl) ||
        all.find((x) => x.variableCollectionId === col.id && x.name.toLowerCase() === nsl) ||
        null
      );
    };

    if (!ref.includes('/')) {
      const s = sanitizeVariableName(ref);
      let v = all.find((x) => x.name === ref || x.name === s) || null;
      if (v) return v;
      const rl = ref.toLowerCase();
      const sl = s.toLowerCase();
      return all.find((x) => x.name.toLowerCase() === rl || x.name.toLowerCase() === sl) || null;
    }

    const i = ref.indexOf('/');
    const colName = trim(ref.slice(0, i));
    const varName = trim(ref.slice(i + 1));
    if (!varName) return null;

    const col = colMatch(colName);
    if (col) {
      const v = varInCol(col, varName);
      if (v) return v;
    }

    // Whole ref as unscoped variable name (single segment in UI listing)
    const sref = sanitizeVariableName(ref);
    let v = all.find((x) => x.name === ref || x.name === sref) || null;
    if (v) return v;
    const rfl = ref.toLowerCase();
    const srfl = sref.toLowerCase();
    return (
      all.find((x) => x.name.toLowerCase() === rfl || x.name.toLowerCase() === srfl) || null
    );
  };

  // Bind FLOAT variables (var:…) or plain numbers to scalar fields: padding, gap, radius, opacity, etc.
  // Prefer #setBoundVariable over assigning VARIABLE_ALIAS objects — see Figma Plugin API.
  /** Node.opacity is 0–1. Literal JSX opacity={50} often means 50%; values > 1 are treated as percent. */
  const normalizeOpacityForNode = (num) => {
    let o = num;
    if (o > 1) o = o / 100;
    return Math.max(0, Math.min(1, o));
  };

  const applyScalarBinding = async (node, field, spec) => {
    if (spec == null || spec === '') return;
    const startsVar = typeof spec === 'string' && spec.trim().startsWith('var:');
    if (startsVar) {
      const ref = String(spec).slice(4).trim();
      const variable = await findVariable(ref, 'FLOAT');
      if (!variable) throw new Error('FLOAT variable not found: ' + ref);
      if (typeof node.setBoundVariable !== 'function') {
        throw new Error('Node type "' + node.type + '" does not support variable bindings');
      }
      try {
        // FLOAT vars bound to opacity usually use 0–100 in Figma; mode values like 0.5 read as 0.5%.
        node.setBoundVariable(field, variable);
      } catch (e) {
        throw new Error('setBoundVariable(' + field + '): ' + (e.message || String(e)));
      }
      return;
    }
    const num = typeof spec === 'number' ? spec : parseFloat(String(spec));
    if (!Number.isFinite(num)) throw new Error('Invalid numeric value for ' + field + ': ' + spec);
    if (typeof node.resetBoundVariable === 'function') {
      try { node.resetBoundVariable(field); } catch {}
    }
    if (field === 'width' || field === 'height') {
      if (typeof node.resize === 'function') {
        const W = field === 'width' ? num : node.width;
        const H = field === 'height' ? num : node.height;
        if (W > 0 && H > 0) node.resize(W, H);
      }
      return;
    }
    if (field === 'opacity') {
      node.opacity = normalizeOpacityForNode(num);
      return;
    }
    node[field] = num;
  };

  // Find or create a variable collection by name.
  const ensureCollection = async (name) => {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    return cols.find(c => c.name === name) || figma.variables.createVariableCollection(name);
  };

  // Find or create a mode in a collection.
  const ensureMode = (col, modeName) => {
    const existing = col.modes.find(m => m.name === modeName);
    if (existing) return existing.modeId;
    return col.addMode(modeName);
  };

  // Find or create a variable in a collection.
  const ensureVariable = async (col, name, type) => {
    const raw = String(name).trim();
    const safe = sanitizeVariableName(raw);
    const all = await figma.variables.getLocalVariablesAsync(type);
    const existing =
      all.find((v) => v.variableCollectionId === col.id && (v.name === safe || v.name === raw)) ||
      null;
    if (existing) return existing;
    const colLabel = col && col.name ? '"' + col.name + '"' : String(col && col.id ? col.id : '?');
    try {
      return figma.variables.createVariable(safe, col, type);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      throw new Error('createVariable(name="' + safe + '", rawName="' + raw + '", type=' + type + ', collection=' + colLabel + '): ' + msg);
    }
  };

  // Smart x position: place new node to the right of existing top-level nodes.
  const nextX = (gap = 100) => {
    let x = 0, has = false;
    for (const n of figma.currentPage.children) {
      const nx = (n.x ?? 0) + (n.width ?? 0);
      if (nx > x) x = nx;
      has = true;
    }
    return has ? x + gap : 0;
  };

  // Locate a component or component-set anywhere in the document.
  // Accepts a node id, a component name, or a "Set/Variant" path.
  const findComponent = async (ref) => {
    if (!ref) return null;
    if (typeof ref === 'string' && ref.startsWith('I:')) return null;
    const r = String(ref);
    if (r.includes(':') && !r.includes('/')) {
      const direct = await figma.getNodeByIdAsync(r);
      if (direct && (direct.type === 'COMPONENT' || direct.type === 'COMPONENT_SET')) return direct;
    }
    let setName; let variantName;
    if (!r.includes('/')) {
      setName = r;
      variantName = null;
    } else {
      const i = r.indexOf('/');
      setName = r.slice(0, i).trim();
      variantName = r.slice(i + 1).trim() || null;
    }
    const all = (await figma.loadAllPagesAsync ? await figma.loadAllPagesAsync() : null);
    const matches = [];
    const walk = (n) => {
      if (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') matches.push(n);
      if ('children' in n) for (const c of n.children) walk(c);
    };
    walk(figma.root);
    const set = matches.find(n => n.name === setName);
    if (!set) return null;
    if (!variantName || set.type !== 'COMPONENT_SET') return set;
    return set.children.find(c => c.name === variantName) || set;
  };

  // Parse "State=Hover, Size=Sm" → { State: 'Hover', Size: 'Sm' }.
  // Use first "=" only per segment so values may contain "=".
  const parseVariantSpec = (spec) => {
    if (!spec) return {};
    const out = {};
    for (const part of String(spec).split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k && v) out[k] = v;
    }
    return out;
  };

  // Apply text/instance overrides to an instance by matching child node names.
  // overrides = { Label: 'Click me', Title: 'Hello' }
  // For nested instances (e.g. a Card with a Button inside), the override
  // recurses into the inner instance and sets its primary text node.
  const setText = async (text, val) => {
    const fn = text.fontName === figma.mixed ? { family: 'Inter', style: 'Regular' } : text.fontName;
    try { await figma.loadFontAsync(fn); } catch { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); }
    text.characters = String(val);
  };

  const applyInstanceOverrides = async (instance, overrides) => {
    if (!overrides) return;
    for (const [key, val] of Object.entries(overrides)) {
      if (val == null) continue;
      const target = instance.findOne ? instance.findOne(n => n.name === key) : null;
      if (!target) continue;

      if (target.type === 'TEXT') {
        await setText(target, val);
        continue;
      }

      if (val === false || val === 'false' || val === 'hidden') {
        if ('visible' in target) target.visible = false;
        continue;
      }

      if (target.type === 'INSTANCE') {
        // Recurse: set the primary text inside this nested instance.
        const inner =
          target.findOne(n => n.type === 'TEXT' && (n.name === 'Label' || n.name === 'Text')) ||
          target.findOne(n => n.type === 'TEXT');
        if (inner) await setText(inner, val);
        continue;
      }

      if ('characters' in target) {
        await setText(target, val);
      }
    }
  };

  // Create an instance of a component / component-set with variant + overrides.
  // ref can be id, "Name", or "Set/Variant"
  const instantiate = async (ref, opts = {}) => {
    const comp = await findComponent(ref);
    if (!comp) throw new Error('Component not found: ' + ref);
    let target = comp;
    if (comp.type === 'COMPONENT_SET') {
      const variantProps = parseVariantSpec(opts.variant);
      const matchByProps = comp.children.find(c => {
        const map = parseVariantSpec(c.name);
        return Object.entries(variantProps).every(([k, v]) => map[k] === v);
      });
      target = matchByProps || comp.defaultVariant || comp.children[0];
    }
    const inst = target.createInstance();
    if (comp.type === 'COMPONENT_SET' && opts.variant) {
      const props = parseVariantSpec(opts.variant);
      try { inst.setProperties(props); } catch {}
    }
    if (opts.overrides) await applyInstanceOverrides(inst, opts.overrides);
    return inst;
  };

  // Resolve a node by id or use the current selection.
  const getNode = async (idOrNull) => {
    if (idOrNull) return await figma.getNodeByIdAsync(idOrNull);
    const sel = figma.currentPage.selection;
    return sel.length ? sel[0] : null;
  };

  // Load a font, retrying with reasonable fallbacks.
  const loadFont = async (family = 'Inter', style = 'Regular') => {
    const alternates = [style];
    if (style === 'Semi Bold') alternates.push('SemiBold');
    if (style === 'SemiBold') alternates.push('Semi Bold');
    for (const s of alternates) {
      try {
        await figma.loadFontAsync({ family, style: s });
        return { family, style: s };
      } catch {}
    }
    try { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); return { family: 'Inter', style: 'Regular' }; }
    catch {}
    await figma.loadFontAsync({ family: 'Roboto', style: 'Regular' });
    return { family: 'Roboto', style: 'Regular' };
  };

  // Serialize a node into a small JSON-friendly summary.
  const summarize = (n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height
  });

  return {
    __v: ${RUNTIME_VERSION},
    hexToRgb, rgbToHex,
    resolveColor, paint, applyFill, applyStroke,
    applyScalarBinding,
    findVariable, ensureCollection, ensureMode, ensureVariable,
    nextX, getNode, loadFont, summarize,
    findComponent, parseVariantSpec, applyInstanceOverrides, instantiate
  };
})());
`;

// Wrap a body of Figma plugin code with the runtime + a return statement.
// The body should be a single expression or an IIFE that returns the result.
export function withRuntime(body) {
  return `(async () => {
    ${RUNTIME}
    return await (async () => { return (${body}); })();
  })()`;
}
