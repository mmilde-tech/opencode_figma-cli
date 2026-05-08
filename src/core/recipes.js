// Deterministic, high-level "recipes" that reduce model wandering.
// Recipes should be:
// - Idempotent (safe to run repeatedly)
// - Strict about structure (names/variants)
// - Token-friendly (use var:... for colors, and supported FLOAT bindings)

import { parseJSX, createComponentSet, listComponents, deleteNodes } from './operations.js';

/**
 * Rebuild a component set by name (delete existing + recreate).
 * This is the simplest idempotent strategy that avoids drift.
 */
export async function rebuildComponentSet(client, { name, variants }) {
  if (!name) throw new Error('name required');
  if (!Array.isArray(variants) || variants.length === 0) throw new Error('variants required');

  // Find existing components/sets with this name.
  const comps = await listComponents(client);
  const existing = comps.filter((c) => c.name === name);
  if (existing.length) {
    // Remove old set(s)/components by id.
    await deleteNodes(client, { nodeIds: existing.map((e) => e.id) });
  }

  // Create fresh set.
  return await createComponentSet(client, { name, variants });
}

/**
 * Apply tokens to either current selection or provided nodeIds.
 *
 * Supported bindings:
 * - Colors: fill/bg/stroke/text -> uses _oc.applyFill/_oc.applyStroke (supports var:... COLOR variables)
 * - Scalars (FLOAT): radius, gap, padding*, opacity, fontSize -> uses _oc.applyScalarBinding (supports var:... FLOAT vars)
 *
 * Notes:
 * - Figma does not reliably persist FLOAT variable binding for strokeWeight today.
 *   We support strokeWidth as a NUMBER only (applied as a raw number).
 */
export async function applyTokens(client, args = {}) {
  const ctx = {
    nodeIds: Array.isArray(args.nodeIds) && args.nodeIds.length ? args.nodeIds : null,
    tokens: args.tokens || {},
    mode: args.mode || 'selection'
  };

  return await client.run(`(async () => {
    const t = ctx.tokens || {};
    const isVar = (v) => typeof v === 'string' && v.trim().startsWith('var:');
    const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
    const num = (v) => typeof v === 'number' ? v : Number(v);

    const pickNodes = async () => {
      if (ctx.nodeIds && ctx.nodeIds.length) {
        return (await Promise.all(ctx.nodeIds.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
      }
      return figma.currentPage.selection.slice();
    };

    const nodes = await pickNodes();
    if (!nodes.length) throw new Error('No nodes selected (or invalid nodeIds).');

    const changed = [];
    const applyTo = async (n) => {
      const did = { id: n.id, name: n.name, type: n.type, props: [] };

      // --- color tokens ---
      const fill = t.fill ?? t.bg ?? null;
      if (fill != null && 'fills' in n && n.type !== 'TEXT') {
        await _oc.applyFill(n, fill);
        did.props.push('fill');
      }
      const stroke = t.stroke ?? null;
      if (stroke != null && 'strokes' in n) {
        // weight: only numeric (binding strokeWeight vars is unreliable)
        const sw = t.strokeWidth;
        const w = sw != null && isNum(sw) ? num(sw) : undefined;
        await _oc.applyStroke(n, stroke, w);
        did.props.push('stroke');
        if (w != null) did.props.push('strokeWidth');
      }
      const text = t.text ?? t.color ?? null;
      if (text != null && n.type === 'TEXT') {
        await _oc.applyFill(n, text);
        did.props.push('textFill');
      }

      // --- scalar tokens (FLOAT bindings supported) ---
      const radius = t.radius ?? t.rounded ?? null;
      if (radius != null && 'cornerRadius' in n) {
        await _oc.applyScalarBinding(n, 'cornerRadius', radius);
        did.props.push('radius');
      }
      const opacity = t.opacity ?? null;
      if (opacity != null && 'opacity' in n) {
        await _oc.applyScalarBinding(n, 'opacity', opacity);
        did.props.push('opacity');
      }
      const fontSize = t.fontSize ?? null;
      if (fontSize != null && n.type === 'TEXT') {
        await _oc.applyScalarBinding(n, 'fontSize', fontSize);
        did.props.push('fontSize');
      }
      const gap = t.gap ?? t.itemSpacing ?? null;
      if (gap != null && 'itemSpacing' in n && n.layoutMode && n.layoutMode !== 'NONE') {
        await _oc.applyScalarBinding(n, 'itemSpacing', gap);
        did.props.push('gap');
      }
      const p = t.p ?? t.padding ?? null;
      if (p != null && 'paddingLeft' in n && n.layoutMode && n.layoutMode !== 'NONE') {
        await _oc.applyScalarBinding(n, 'paddingLeft', p);
        await _oc.applyScalarBinding(n, 'paddingRight', p);
        await _oc.applyScalarBinding(n, 'paddingTop', p);
        await _oc.applyScalarBinding(n, 'paddingBottom', p);
        did.props.push('padding');
      }
      // specific paddings override p
      const pads = [
        ['paddingLeft', t.pl ?? t.paddingLeft],
        ['paddingRight', t.pr ?? t.paddingRight],
        ['paddingTop', t.pt ?? t.paddingTop],
        ['paddingBottom', t.pb ?? t.paddingBottom]
      ];
      for (const [field, value] of pads) {
        if (value != null && 'paddingLeft' in n && n.layoutMode && n.layoutMode !== 'NONE') {
          await _oc.applyScalarBinding(n, field, value);
          did.props.push(field);
        }
      }

      if (did.props.length) changed.push(did);
    };

    // Apply recursively to selected nodes AND their descendants (optional).
    const deep = t.deep === true || t.deep === 'true';
    const walk = async (n) => {
      await applyTo(n);
      if (deep && 'children' in n) {
        for (const c of n.children) await walk(c);
      }
    };
    for (const n of nodes) await walk(n);

    return { selected: nodes.length, changed };
  })()`, ctx);
}

/**
 * Input field component set — hex defaults work without variables (Windows/Mac parity).
 * Optional args still accept var:name after you create tokens via figma_tokens.
 * @param {'default'|'compact'} preset — compact = tighter heights, padding, radii (same 9 variants).
 */
export function inputRecipe({
  strokeVar = '#CBD5E1',
  bgVar = '#FFFFFF',
  textVar = '#475569',
  preset = 'default'
} = {}) {
  const compact = String(preset || 'default').toLowerCase() === 'compact';
  const sizes = compact
    ? [
        { Size: 'Sm', h: 32, px: 10, text: 12, r: 6 },
        { Size: 'Md', h: 36, px: 12, text: 13, r: 8 },
        { Size: 'Lg', h: 40, px: 14, text: 14, r: 10 }
      ]
    : [
        { Size: 'Sm', h: 36, px: 12, text: 13, r: 8 },
        { Size: 'Md', h: 40, px: 14, text: 14, r: 10 },
        { Size: 'Lg', h: 44, px: 16, text: 15, r: 12 }
      ];
  const states = [
    { State: 'Default', strokeWidth: 1, opacity: 1, bg: bgVar, fg: textVar, st: strokeVar },
    { State: 'Hover', strokeWidth: 1.5, opacity: 1, bg: '#F8FAFC', fg: '#334155', st: '#94A3B8' },
    { State: 'Disabled', strokeWidth: 1, opacity: 0.5, bg: '#F1F5F9', fg: '#94A3B8', st: '#E2E8F0' }
  ];

  const variants = [];
  for (const s of sizes) {
    for (const st of states) {
      variants.push({
        properties: { State: st.State, Size: s.Size },
        jsx: `<Frame name="Input" flex="row" items="center" justify="start" w={320} h={${s.h}} px={${s.px}} bg="${st.bg}" stroke="${st.st}" strokeWidth={${st.strokeWidth}} rounded={${s.r}} opacity={${st.opacity}}>
  <Text name="Placeholder" size={${s.text}} color="${st.fg}">Placeholder text</Text>
</Frame>`
      });
    }
  }
  return { name: 'Input', variants };
}

/**
 * Button recipe: State variants with a named Label text node.
 * @param {'default'|'compact'} preset — compact = slightly smaller padding, radius, type.
 */
export function buttonRecipe({
  bgVar = '#7C3AED',
  fgVar = '#FFFFFF',
  mutedBgVar = '#E5E7EB',
  mutedFgVar = '#6B7280',
  preset = 'default'
} = {}) {
  const compact = String(preset || 'default').toLowerCase() === 'compact';
  const gap = compact ? 6 : 8;
  const px = compact ? 14 : 16;
  const py = compact ? 8 : 10;
  const r = compact ? 6 : 8;
  const fs = compact ? 13 : 14;

  const base = (over) =>
    `<Frame name="Button" flex="row" gap={${gap}} px={${px}} py={${py}} rounded={${r}} justify="center" items="center" ${over}>
  <Text name="Label" size={${fs}} weight="medium" color="${fgVar}">Button</Text>
</Frame>`;

  return {
    name: 'Button',
    variants: [
      {
        properties: { State: 'Default' },
        jsx: base(`bg="${bgVar}"`)
      },
      {
        properties: { State: 'Hover' },
        jsx: base(`bg="${bgVar}" opacity={0.9}`)
      },
      {
        properties: { State: 'Disabled' },
        jsx: `<Frame name="Button" flex="row" gap={${gap}} px={${px}} py={${py}} rounded={${r}} justify="center" items="center" bg="${mutedBgVar}" opacity={0.6}>
  <Text name="Label" size={${fs}} weight="medium" color="${mutedFgVar}">Button</Text>
</Frame>`
      }
    ]
  };
}

/**
 * Marketing-style hero block (single variant). Named text nodes for instance overrides.
 * Hex defaults work without design tokens.
 */
export function heroRecipe({
  bg = '#F8FAFC',
  eyebrowColor = '#64748B',
  titleColor = '#0F172A',
  subtitleColor = '#475569',
  primaryCtaColor = '#FFFFFF',
  primaryCtaBg = '#7C3AED',
  secondaryColor = '#475569',
  secondaryStroke = '#CBD5E1'
} = {}) {
  return {
    name: 'Hero',
    variants: [
      {
        properties: { Layout: 'Default' },
        jsx: `<Frame name="Hero" flex="col" gap={16} p={48} bg="${bg}" w={960}>
  <Text name="Eyebrow" size={12} weight="medium" color="${eyebrowColor}">New</Text>
  <Text name="Title" size={40} weight="bold" color="${titleColor}">Headline that converts</Text>
  <Text name="Subtitle" size={18} color="${subtitleColor}">One or two sentences about your product. Keep it clear and benefit-led.</Text>
  <Frame name="Actions" flex="row" gap={12}>
    <Frame name="PrimaryCta" flex="row" px={20} py={12} rounded={8} bg="${primaryCtaBg}" justify="center" items="center">
      <Text name="PrimaryCtaLabel" size={14} weight="semibold" color="${primaryCtaColor}">Get started</Text>
    </Frame>
    <Frame name="SecondaryCta" flex="row" px={20} py={12} rounded={8} stroke="${secondaryStroke}" strokeWidth={1} justify="center" items="center">
      <Text name="SecondaryCtaLabel" size={14} weight="medium" color="${secondaryColor}">Learn more</Text>
    </Frame>
  </Frame>
</Frame>`
      }
    ]
  };
}

/**
 * Card with Title, Description, and Action text. Hex defaults; use var: after tokens exist.
 */
export function cardRecipe({
  bg = '#FFFFFF',
  stroke = '#E2E8F0',
  titleColor = '#0F172A',
  descColor = '#64748B',
  actionColor = '#7C3AED'
} = {}) {
  return {
    name: 'Card',
    variants: [
      {
        properties: { Style: 'Default' },
        jsx: `<Frame name="Card" flex="col" gap={12} p={20} bg="${bg}" stroke="${stroke}" strokeWidth={1} rounded={12} w={320}>
  <Text name="Title" size={18} weight="semibold" color="${titleColor}">Card title</Text>
  <Text name="Description" size={14} color="${descColor}">Short description goes here.</Text>
  <Text name="Action" size={14} weight="medium" color="${actionColor}">View details</Text>
</Frame>`
      }
    ]
  };
}

/** Badge pill — Tone × Size (4 variants). */
export function badgeRecipe({
  defaultBg = '#EEF2FF',
  defaultFg = '#4338CA',
  mutedBg = '#F1F5F9',
  mutedFg = '#64748B'
} = {}) {
  const row = (tone, size, px, py, fs, bg, fg) => ({
    properties: { Tone: tone, Size: size },
    jsx: `<Frame name="Badge" flex="row" items="center" justify="center" px={${px}} py={${py}} rounded={999} bg="${bg}">
  <Text name="Label" size={${fs}} weight="medium" color="${fg}">Badge</Text>
</Frame>`
  });
  return {
    name: 'Badge',
    variants: [
      row('Default', 'Sm', 8, 4, 12, defaultBg, defaultFg),
      row('Default', 'Md', 10, 5, 13, defaultBg, defaultFg),
      row('Muted', 'Sm', 8, 4, 12, mutedBg, mutedFg),
      row('Muted', 'Md', 10, 5, 13, mutedBg, mutedFg)
    ]
  };
}

