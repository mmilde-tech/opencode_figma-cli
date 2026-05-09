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

export function normalizeRecipePreset(p) {
  return String(p || 'default').toLowerCase().trim() === 'compact' ? 'compact' : 'default';
}

/**
 * Inline toast / banner alert — Type × tone strip + Title + Message text overrides.
 */
export function notificationRecipe({
  /** When set, replaces every tone's accent strip color (hex or var:…). */
  toneAccent,
  toneBg,
  toneBorder,
  toneTitle,
  toneBody,
  infoAccent = '#3B82F6',
  infoBg = '#EFF6FF',
  infoBorder = '#BFDBFE',
  infoTitle = '#1E3A8A',
  infoBody = '#1E40AF',
  successAccent = '#22C55E',
  successBg = '#F0FDF4',
  successBorder = '#BBF7D0',
  successTitle = '#14532D',
  successBody = '#166534',
  warningAccent = '#F59E0B',
  warningBg = '#FFFBEB',
  warningBorder = '#FDE68A',
  warningTitle = '#78350F',
  warningBody = '#92400E',
  errorAccent = '#EF4444',
  errorBg = '#FEF2F2',
  errorBorder = '#FECACA',
  errorTitle = '#7F1D1D',
  errorBody = '#991B1B'
} = {}) {
  const tones = [
    {
      Type: 'Info',
      accent: toneAccent ?? infoAccent,
      bg: toneBg ?? infoBg,
      border: toneBorder ?? infoBorder,
      title: toneTitle ?? infoTitle,
      body: toneBody ?? infoBody
    },
    {
      Type: 'Success',
      accent: toneAccent ?? successAccent,
      bg: toneBg ?? successBg,
      border: toneBorder ?? successBorder,
      title: toneTitle ?? successTitle,
      body: toneBody ?? successBody
    },
    {
      Type: 'Warning',
      accent: toneAccent ?? warningAccent,
      bg: toneBg ?? warningBg,
      border: toneBorder ?? warningBorder,
      title: toneTitle ?? warningTitle,
      body: toneBody ?? warningBody
    },
    {
      Type: 'Error',
      accent: toneAccent ?? errorAccent,
      bg: toneBg ?? errorBg,
      border: toneBorder ?? errorBorder,
      title: toneTitle ?? errorTitle,
      body: toneBody ?? errorBody
    }
  ];
  return {
    name: 'Notification',
    variants: tones.map((t) => ({
      properties: { Type: t.Type },
      jsx: `<Frame name="Notification" flex="row" gap={12} p={16} w={400} rounded={10} bg="${t.bg}" stroke="${t.border}" strokeWidth={1} items="start">
  <Rect w={4} h={44} rounded={2} fill="${t.accent}" />
  <Frame flex="col" gap={4} grow={1}>
    <Text name="Title" size={14} weight="semibold" color="${t.title}">Notification title</Text>
    <Text name="Message" size={13} color="${t.body}">Short supporting message goes here.</Text>
  </Frame>
</Frame>`
    }))
  };
}

/** Single accordion row — Collapsed vs Expanded (named Title + Body for overrides). */
export function accordionRecipe({
  stroke = '#E2E8F0',
  titleColor = '#0F172A',
  bodyColor = '#475569',
  hintColor = '#64748B'
} = {}) {
  const collapsedBodyOpacity = 0;
  const expandedBodyOpacity = 1;
  return {
    name: 'AccordionItem',
    variants: [
      {
        properties: { State: 'Collapsed' },
        jsx: `<Frame name="AccordionItem" flex="col" w={380} rounded={10} stroke="${stroke}" strokeWidth={1}>
  <Frame flex="row" justify="between" items="center" px={16} py={14}>
    <Text name="Title" size={15} weight="semibold" color="${titleColor}">Section title</Text>
    <Text size={13} color="${hintColor}">▼</Text>
  </Frame>
  <Frame flex="col" px={16} pb={12} opacity={${collapsedBodyOpacity}}>
    <Text name="Body" size={14} color="${bodyColor}">Supporting detail copy goes here and wraps naturally inside the accordion.</Text>
  </Frame>
</Frame>`
      },
      {
        properties: { State: 'Expanded' },
        jsx: `<Frame name="AccordionItem" flex="col" w={380} rounded={10} stroke="${stroke}" strokeWidth={1}>
  <Frame flex="row" justify="between" items="center" px={16} py={14}>
    <Text name="Title" size={15} weight="semibold" color="${titleColor}">Section title</Text>
    <Text size={13} color="${hintColor}">▲</Text>
  </Frame>
  <Frame flex="col" px={16} pb={14} opacity={${expandedBodyOpacity}}>
    <Text name="Body" size={14} color="${bodyColor}">Supporting detail copy goes here and wraps naturally inside the accordion.</Text>
  </Frame>
</Frame>`
      }
    ]
  };
}

/** Toggle / switch track — Off vs On (Label text override). */
export function switchRecipe({
  trackOff = '#E5E7EB',
  trackOn = '#7C3AED',
  knobFill = '#FFFFFF',
  labelColor = '#334155'
} = {}) {
  const knob = `<Rect w={20} h={20} rounded={999} fill="${knobFill}" />`;
  return {
    name: 'Switch',
    variants: [
      {
        properties: { State: 'Off' },
        jsx: `<Frame name="Switch" flex="row" items="center" gap={12}>
  <Text name="Label" size={14} weight="medium" color="${labelColor}">Notifications</Text>
  <Frame flex="row" w={44} h={24} rounded={12} bg="${trackOff}" items="center" pl={2} pr={2} justify="start">
    ${knob}
  </Frame>
</Frame>`
      },
      {
        properties: { State: 'On' },
        jsx: `<Frame name="Switch" flex="row" items="center" gap={12}>
  <Text name="Label" size={14} weight="medium" color="${labelColor}">Notifications</Text>
  <Frame flex="row" w={44} h={24} rounded={12} bg="${trackOn}" items="center" pl={2} pr={2} justify="end">
    ${knob}
  </Frame>
</Frame>`
      }
    ]
  };
}

/**
 * Checkbox — Checked × Disabled (4 variants). Named Label for instance overrides.
 * Outer box uses flex row + nested flex wrappers so ✓ centers; renderer applies justify/items only when flex is set.
 */
export function checkboxRecipe({
  borderVar = '#CBD5E1',
  bgVar = '#FFFFFF',
  primaryVar = '#7C3AED',
  checkFg = '#FFFFFF',
  labelColor = '#334155',
  mutedBorder = '#E2E8F0',
  mutedBg = '#F1F5F9',
  labelMuted = '#94A3B8'
} = {}) {
  const variants = [];
  for (const checked of ['No', 'Yes']) {
    for (const disabled of ['No', 'Yes']) {
      const isOn = checked === 'Yes';
      const isDis = disabled === 'Yes';
      const rowOp = isDis ? 0.5 : 1;
      const boxBg = isOn ? primaryVar : isDis ? mutedBg : bgVar;
      const boxStroke = isOn ? primaryVar : isDis ? mutedBorder : borderVar;
      const strokeW = isOn ? 0 : 1;
      const labelCol = isDis ? labelMuted : labelColor;
      
      let checkmark = '';
      if (isOn) {
        checkmark = `<Frame flex="row" w={18} h={18} justify="center" items="center">
    <Frame flex="row" w={18} h={18} justify="center" items="center">
      <Frame name="Checkmark" flex="row" justify="center" items="center">
        <Text size={11} weight="bold" color="${checkFg}">✓</Text>
      </Frame>
    </Frame>
  </Frame>`;
      }

      variants.push({
        properties: { Checked: checked, Disabled: disabled },
        jsx: `<Frame name="Checkbox" flex="row" items="center" gap={10} opacity={${rowOp}}>
  <Frame flex="row" w={18} h={18} rounded={4} bg="${boxBg}" stroke="${boxStroke}" strokeWidth={${strokeW}} justify="center" items="center">
    ${checkmark}
  </Frame>
  <Text name="Label" size={14} color="${labelCol}">Option label</Text>
</Frame>`
      });
    }
  }
  return { name: 'Checkbox', variants };
}

/**
 * Radio button — Selected × Disabled (4 variants).
 * Outer ring (always visible) + inner dot (only when Selected=Yes).
 * Container has NO flex layout so ring and dot overlap at same position.
 * Dot is centered via nested flex Frame matching container size (18px).
 */
export function radioRecipe({
  borderVar = '#CBD5E1',
  bgVar = '#FFFFFF',
  primaryVar = '#7C3AED',
  labelColor = '#334155',
  mutedBorder = '#E2E8F0',
  labelMuted = '#94A3B8'
} = {}) {
  const variants = [];
  for (const selected of ['No', 'Yes']) {
    for (const disabled of ['No', 'Yes']) {
      const isOn = selected === 'Yes';
      const isDis = disabled === 'Yes';
      const rowOp = isDis ? 0.5 : 1;
      const ringStroke = isOn ? primaryVar : (isDis ? mutedBorder : borderVar);
      const ringFill = bgVar;
      const strokeW = 2;
      const labelCol = isDis ? labelMuted : labelColor;
      
      let innerDot = '';
      if (isOn) {
        innerDot = `<Frame flex="row" w={18} h={18} justify="center" items="center">
    <Ellipse w={8} h={8} fill="${primaryVar}" />
  </Frame>`;
      }

      variants.push({
        properties: { Selected: selected, Disabled: disabled },
        jsx: `<Frame name="Radio" flex="row" items="center" gap={10} opacity={${rowOp}}>
  <Frame w={18} h={18} rounded={999}>
    <Ellipse w={18} h={18} fill="${ringFill}" stroke="${ringStroke}" strokeWidth={${strokeW}} />
    ${innerDot}
  </Frame>
  <Text name="Label" size={14} color="${labelCol}">Option label</Text>
</Frame>`
      });
    }
  }
  return { name: 'Radio', variants };
}

const BUILD_KIND_ALIASES = new Map([
  ['text field', 'input'],
  ['textfield', 'input'],
  ['text-field', 'input'],
  ['marketing hero', 'hero'],
  ['marketing-hero', 'hero'],
  ['toggle', 'switch'],
  ['radio button', 'radio'],
  ['radio-button', 'radio'],
  ['radiobutton', 'radio'],
  ['toast', 'notification'],
  ['banner', 'notification'],
  ['alert', 'notification'],
  ['inline alert', 'notification'],
  ['inline-alert', 'notification'],
  ['collapsible', 'accordion'],
  ['accordion item', 'accordion'],
  ['accordion-item', 'accordion'],
  ['accordionitem', 'accordion']
]);

/** Normalize figma_build / CLI kind tokens before resolving recipes. */
export function normalizeBuildKind(kind) {
  let k = String(kind || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  const mapped = BUILD_KIND_ALIASES.get(k);
  return mapped || k;
}

/**
 * Returns { name, variants } for idempotent rebuild recipes.
 * Token-apply and unknown keys yield null.
 */
export function getRecipeRebuildSpec(recipe, args = {}) {
  const r = String(recipe || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  const alias = BUILD_KIND_ALIASES.get(r);
  const key = alias || r;
  const preset = normalizeRecipePreset(args.preset);

  if (key === 'input') {
    return inputRecipe({
      strokeVar: args.strokeVar,
      bgVar: args.bgVar,
      textVar: args.textVar,
      preset
    });
  }
  if (key === 'button') {
    return buttonRecipe({
      bgVar: args.buttonBgVar,
      fgVar: args.buttonFgVar,
      mutedBgVar: args.buttonMutedBgVar,
      mutedFgVar: args.buttonMutedFgVar,
      preset
    });
  }
  if (key === 'card') return cardRecipe({});
  if (key === 'badge') return badgeRecipe({});
  if (key === 'hero') return heroRecipe({});
  if (key === 'notification') {
    return notificationRecipe({
      toneAccent: args.notificationAccentVar,
      toneBg: args.notificationBgVar,
      toneBorder: args.notificationBorderVar,
      toneTitle: args.notificationTitleVar,
      toneBody: args.notificationBodyVar
    });
  }
  if (key === 'accordion') {
    return accordionRecipe({
      stroke: args.accordionStrokeVar ?? args.strokeVar,
      titleColor: args.accordionTitleVar ?? args.textVar,
      bodyColor: args.accordionBodyVar,
      hintColor: args.accordionHintVar
    });
  }
  if (key === 'switch') {
    return switchRecipe({
      trackOff: args.switchTrackOffVar,
      trackOn: args.switchTrackOnVar ?? args.buttonBgVar,
      knobFill: args.switchKnobFillVar ?? args.buttonFgVar,
      labelColor: args.switchLabelVar ?? args.textVar
    });
  }
  if (key === 'checkbox' || key === 'checkboxes') {
    return checkboxRecipe({
      borderVar: args.checkboxBorderVar ?? args.strokeVar,
      bgVar: args.checkboxBgVar ?? args.bgVar,
      primaryVar: args.checkboxPrimaryVar ?? args.buttonBgVar,
      checkFg: args.checkboxCheckFgVar ?? args.buttonFgVar,
      mutedBorder: args.checkboxMutedBorderVar,
      mutedBg: args.checkboxMutedBgVar ?? args.buttonMutedBgVar,
      labelColor: args.checkboxLabelVar ?? args.textVar,
      labelMuted: args.checkboxLabelMutedVar ?? args.buttonMutedFgVar
    });
  }
  if (key === 'radio') {
    return radioRecipe({
      borderVar: args.radioBorderVar ?? args.strokeVar,
      bgVar: args.radioBgVar ?? args.bgVar,
      primaryVar: args.radioPrimaryVar ?? args.buttonBgVar,
      mutedBorder: args.radioMutedBorderVar,
      labelColor: args.radioLabelVar ?? args.textVar,
      labelMuted: args.radioLabelMutedVar ?? args.buttonMutedFgVar
    });
  }
  return null;
}

