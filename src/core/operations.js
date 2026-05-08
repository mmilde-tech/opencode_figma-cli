// High-level operations on a connected FigmaClient.
//
// Every function here:
//   - Takes a connected FigmaClient as the first argument.
//   - Returns structured JSON-friendly data (or throws with a clear message).
//   - Does NOT log to stdout, does NOT exit the process.
//
// Both the CLI (src/cli/*) and the OpenCode plugin (src/index.js) call into
// these. CLIs add pretty-printing; the plugin returns a string summary.

import { SHADCN, tailwindFlat, dsFlat } from './presets.js';

// ---------------------------------------------------------------------------
// Create / set
// ---------------------------------------------------------------------------

const FACTORIES = {
  frame: 'createFrame',
  rect: 'createRectangle',
  rectangle: 'createRectangle',
  circle: 'createEllipse',
  ellipse: 'createEllipse',
  line: 'createLine',
  star: 'createStar',
  polygon: 'createPolygon',
  text: 'createText',
  icon: 'createFrame'
};

export async function createNode(client, args) {
  const t = String(args.type || '').toLowerCase();
  if (!FACTORIES[t]) {
    throw new Error(`Unknown type "${args.type}". Use: ${Object.keys(FACTORIES).join(', ')}`);
  }

  const fallbackName = t.charAt(0).toUpperCase() + t.slice(1);
  const ctx = {
    type: t,
    factory: FACTORIES[t],
    name: coerceDisplayName(args.name, fallbackName),
    width: numOrNull(args.width),
    height: numOrNull(args.height),
    fill: args.fill ?? null,
    stroke: args.stroke ?? null,
    strokeWidth:
      args.strokeWidth != null && args.strokeWidth !== '' ? args.strokeWidth : null,
    rounded: args.rounded != null && args.rounded !== '' ? args.rounded : null,
    content: args.content ?? null,
    icon: args.icon ?? null
  };

  return await client.run(`(async () => {
    let node;
    if (ctx.type === 'text') {
      const f = await _oc.loadFont('Inter', 'Regular');
      node = figma.createText();
      node.fontName = f;
      node.characters = ctx.content || ctx.name;
    } else if (ctx.type === 'icon') {
      node = figma.createFrame();
      node.clipsContent = true;
      node.layoutMode = 'NONE';
    } else {
      node = figma[ctx.factory]();
    }
    node.name = ctx.name;

    if (typeof node.resize === 'function') {
      const w = ctx.width != null ? ctx.width : (ctx.type === 'icon' ? 24 : (ctx.type === 'circle' || ctx.type === 'ellipse' ? 100 : 320));
      const h = ctx.height != null ? ctx.height : (ctx.type === 'icon' ? 24 : (ctx.type === 'circle' || ctx.type === 'ellipse' ? 100 : 200));
      if (ctx.type !== 'text' && w > 0 && h > 0) node.resize(w, h);
    }
    if (ctx.fill !== null) await _oc.applyFill(node, ctx.fill);
    else if (ctx.type !== 'text' && ctx.type !== 'line') node.fills = [];
    if (ctx.stroke !== null) {
      const sw = ctx.strokeWidth != null && ctx.strokeWidth !== '' ? ctx.strokeWidth : 1;
      await _oc.applyStroke(node, ctx.stroke, sw);
    }
    if (ctx.rounded != null && ctx.rounded !== '' && 'cornerRadius' in node) {
      await _oc.applyScalarBinding(node, 'cornerRadius', ctx.rounded);
    }

    node.x = _oc.nextX();
    node.y = 0;
    figma.currentPage.appendChild(node);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    return _oc.summarize(node);
  })()`, ctx);
}

const SET_ALIASES = {
  'corner-radius': 'radius',
  'rounded': 'radius',
  'cornerradius': 'radius',
  'border-width': 'strokewidth',
  'borderwidth': 'strokewidth',
  'stroke-width': 'strokewidth',
  'counter-axis-spacing': 'counteraxisspacing',
  'counteraxisspacing': 'counteraxisspacing',
  'padding-left': 'paddingleft',
  'padding-right': 'paddingright',
  'padding-top': 'paddingtop',
  'padding-bottom': 'paddingbottom'
};

/** Maps figma_set property names (after aliases, lowercased) to Figma VariableBindable fields (FLOAT). */
const FLOAT_PROP_MAP = {
  paddingleft: 'paddingLeft',
  paddingright: 'paddingRight',
  paddingtop: 'paddingTop',
  paddingbottom: 'paddingBottom',
  gap: 'itemSpacing',
  itemspacing: 'itemSpacing',
  radius: 'cornerRadius',
  cornerradius: 'cornerRadius',
  strokewidth: 'strokeWeight',
  fontsize: 'fontSize',
  letterspacing: 'letterSpacing',
  lineheight: 'lineHeight',
  counteraxisspacing: 'counterAxisSpacing',
  opacity: 'opacity',
  width: 'width',
  height: 'height'
};

export async function setProperty(client, args) {
  const propRaw = String(args.property || '').toLowerCase();
  const prop = SET_ALIASES[propRaw] || propRaw;
  const bindField = FLOAT_PROP_MAP[prop];
  const ctx = { prop, bindField, value: args.value, nodeId: args.nodeId || null };
  return await client.run(`(async () => {
    const node = await _oc.getNode(ctx.nodeId);
    if (!node) throw new Error('No node selected and no nodeId provided');
    if (ctx.bindField) {
      await _oc.applyScalarBinding(node, ctx.bindField, ctx.value);
      return _oc.summarize(node);
    }
    switch (ctx.prop) {
      case 'fill': await _oc.applyFill(node, ctx.value); break;
      case 'stroke': await _oc.applyStroke(node, ctx.value, undefined); break;
      case 'x': node.x = parseFloat(ctx.value); break;
      case 'y': node.y = parseFloat(ctx.value); break;
      case 'name': node.name = String(ctx.value); break;
      case 'visible': node.visible = ctx.value !== 'false' && ctx.value !== '0'; break;
      default: throw new Error(
        'Unknown property: ' + ctx.prop + '. Use fill, stroke, gap, paddingLeft/padding* (or paddingleft), ' +
        'radius/cornerRadius, strokeWidth, fontSize, letterSpacing, lineHeight, counterAxisSpacing, opacity, width, height, x, y, name, visible. ' +
        'FLOAT tokens: value like var:spacing/md or var:collection/name.'
      );
    }
    return _oc.summarize(node);
  })()`, ctx);
}

// ---------------------------------------------------------------------------
// Find / canvas / analyze / lint
// ---------------------------------------------------------------------------

export async function findNodes(client, args) {
  const ctx = {
    pattern: String(args.pattern || ''),
    type: args.type ? String(args.type).toUpperCase() : null
  };
  return await client.run(`(async () => {
    const re = new RegExp(ctx.pattern.replace(/\\*/g, '.*'), 'i');
    const out = [];
    const walk = (node, depth = 0) => {
      if (depth > 0) {
        const matchesType = !ctx.type || node.type === ctx.type;
        const matchesName = re.test(node.name);
        if (matchesType && matchesName) {
          out.push({
            id: node.id, name: node.name, type: node.type,
            x: node.x ?? null, y: node.y ?? null,
            width: node.width ?? null, height: node.height ?? null
          });
        }
      }
      if ('children' in node) for (const c of node.children) walk(c, depth + 1);
    };
    walk(figma.currentPage);
    return out;
  })()`, ctx);
}

export async function canvasInfo(client) {
  return await client.run(`(async () => ({
    page: figma.currentPage.name,
    children: figma.currentPage.children.length,
    selection: figma.currentPage.selection.length,
    selectionDetails: figma.currentPage.selection.map(_oc.summarize),
    viewport: { x: figma.viewport.center.x, y: figma.viewport.center.y, zoom: figma.viewport.zoom }
  }))()`);
}

export async function canvasList(client) {
  return await client.run(`(async () => figma.currentPage.children.map(_oc.summarize))()`);
}

export async function canvasArrange(client, args) {
  const ctx = { layout: String(args.layout || 'grid').toLowerCase(), nodeIds: args.nodeIds || null };
  return await client.run(`(async () => {
    let nodes;
    if (ctx.nodeIds && ctx.nodeIds.length) {
      nodes = (await Promise.all(ctx.nodeIds.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    } else {
      nodes = figma.currentPage.children.slice();
    }
    if (!nodes.length) return { count: 0 };
    const gap = 32;
    if (ctx.layout === 'column') {
      let y = 0;
      for (const n of nodes) { n.x = 0; n.y = y; y += n.height + gap; }
    } else if (ctx.layout === 'row') {
      let x = 0;
      for (const n of nodes) { n.y = 0; n.x = x; x += n.width + gap; }
    } else {
      const cols = Math.ceil(Math.sqrt(nodes.length));
      const cellW = Math.max(...nodes.map(n => n.width)) + gap;
      const cellH = Math.max(...nodes.map(n => n.height)) + gap;
      nodes.forEach((n, i) => {
        n.x = (i % cols) * cellW;
        n.y = Math.floor(i / cols) * cellH;
      });
    }
    figma.viewport.scrollAndZoomIntoView(nodes);
    return { count: nodes.length, layout: ctx.layout };
  })()`, ctx);
}

export async function canvasZoom(client) {
  return await client.run(`(async () => {
    const nodes = figma.currentPage.selection.length
      ? figma.currentPage.selection : figma.currentPage.children;
    if (nodes.length) figma.viewport.scrollAndZoomIntoView(nodes);
    return { count: nodes.length };
  })()`);
}

export async function canvasZoomTo(client, args = {}) {
  const ctx = { nodeIds: args.nodeIds || null };
  return await client.run(`(async () => {
    let nodes;
    if (ctx.nodeIds && ctx.nodeIds.length) {
      nodes = (await Promise.all(ctx.nodeIds.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    } else {
      nodes = figma.currentPage.selection.length
        ? figma.currentPage.selection : figma.currentPage.children;
    }
    if (nodes.length) figma.viewport.scrollAndZoomIntoView(nodes);
    return { count: nodes.length };
  })()`, ctx);
}

export async function canvasClear(client, args = {}) {
  const ctx = { nodeIds: args.nodeIds || null };
  return await client.run(`(async () => {
    let nodes;
    if (ctx.nodeIds && ctx.nodeIds.length) {
      nodes = (await Promise.all(ctx.nodeIds.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    } else {
      nodes = figma.currentPage.children.slice();
    }
    for (const n of nodes) n.remove();
    return { removed: nodes.length };
  })()`, ctx);
}

export async function analyzeColors(client, args) {
  const ctx = { nodeId: args.nodeId || null };
  return await client.run(`(async () => {
    const root = ctx.nodeId ? await figma.getNodeByIdAsync(ctx.nodeId) : figma.currentPage;
    if (!root) throw new Error('Node not found');
    const counts = new Map();
    const bumpPaints = (paints) => {
      if (!paints || paints === figma.mixed || !Array.isArray(paints)) return;
      for (const p of paints) {
        if (p.type !== 'SOLID' || !p.visible) continue;
        const key = _oc.rgbToHex(p.color);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    };
    const walk = (n) => {
      if ('fills' in n) bumpPaints(n.fills);
      if ('strokes' in n) bumpPaints(n.strokes);
      if ('children' in n) for (const c of n.children) walk(c);
    };
    walk(root);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([hex, count]) => ({ hex, count }));
  })()`, ctx);
}

export async function analyzeTypography(client, args) {
  const ctx = { nodeId: args.nodeId || null };
  return await client.run(`(async () => {
    const root = ctx.nodeId ? await figma.getNodeByIdAsync(ctx.nodeId) : figma.currentPage;
    if (!root) throw new Error('Node not found');
    const counts = new Map();
    const walk = (n) => {
      if (n.type === 'TEXT') {
        const f = n.fontName === figma.mixed ? null : n.fontName;
        const s = n.fontSize === figma.mixed ? null : n.fontSize;
        const key = (f ? f.family + ' ' + f.style : 'mixed') + ' / ' + (s != null ? s + 'px' : 'mixed');
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      if ('children' in n) for (const c of n.children) walk(c);
    };
    walk(root);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([font, count]) => ({ font, count }));
  })()`, ctx);
}

export async function analyzeSpacing(client, args) {
  const ctx = { nodeId: args.nodeId || null };
  return await client.run(`(async () => {
    const root = ctx.nodeId ? await figma.getNodeByIdAsync(ctx.nodeId) : figma.currentPage;
    if (!root) throw new Error('Node not found');
    const pads = new Map();
    const gaps = new Map();
    const walk = (n) => {
      if ('paddingLeft' in n) {
        for (const k of ['paddingLeft','paddingRight','paddingTop','paddingBottom']) {
          const v = n[k];
          if (v) pads.set(v, (pads.get(v) || 0) + 1);
        }
      }
      if ('itemSpacing' in n && n.itemSpacing) gaps.set(n.itemSpacing, (gaps.get(n.itemSpacing) || 0) + 1);
      if ('children' in n) for (const c of n.children) walk(c);
    };
    walk(root);
    return {
      paddings: Array.from(pads.entries()).sort((a,b) => a[0]-b[0]).map(([px,count]) => ({ px, count })),
      gaps: Array.from(gaps.entries()).sort((a,b) => a[0]-b[0]).map(([px,count]) => ({ px, count }))
    };
  })()`, ctx);
}

const LINT_RULES = {
  'color-contrast': true,
  'touch-target-size': true,
  'no-default-names': true,
  'layout-grid': true
};

export async function lint(client, args) {
  const rule = args.rule ? String(args.rule).toLowerCase() : null;
  if (rule && !LINT_RULES[rule]) {
    throw new Error(`Unknown rule "${args.rule}". Available: ${Object.keys(LINT_RULES).join(', ')}`);
  }
  const ctx = { rule, nodeId: args.nodeId || null };
  return await client.run(`(async () => {
    const root = ctx.nodeId ? await figma.getNodeByIdAsync(ctx.nodeId) : figma.currentPage;
    if (!root) throw new Error('Node not found');
    const enabled = (r) => {
      if (!ctx.rule) return r !== 'layout-grid';
      return ctx.rule === r;
    };
    const issues = [];
    const rel = (c) => {
      const ch = (v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    };
    const ratio = (a, b) => {
      const l1 = rel(a), l2 = rel(b);
      const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    };
    const firstSolid = (paints) => {
      if (!paints || paints === figma.mixed || !Array.isArray(paints)) return null;
      const p = paints.find(p => p.type === 'SOLID' && p.visible !== false);
      return p ? p.color : null;
    };
    const findBg = (n) => {
      let p = n.parent;
      while (p && p.type !== 'PAGE') {
        if ('fills' in p) { const c = firstSolid(p.fills); if (c) return c; }
        p = p.parent;
      }
      return { r: 1, g: 1, b: 1 };
    };
    const defaultNameRe = /^(Frame|Rectangle|Ellipse|Group|Vector|Text|Component|Instance)( \\d+)?$/;
    const interactiveRe = /button|btn|cta|tap|click|link/i;

    const walk = (n) => {
      if (enabled('no-default-names') && defaultNameRe.test(n.name)) {
        issues.push({ rule: 'no-default-names', node: _oc.summarize(n), msg: 'Default node name: "' + n.name + '"' });
      }
      if (enabled('touch-target-size')) {
        const isInteractive = n.type === 'COMPONENT' || n.type === 'INSTANCE' || (typeof n.name === 'string' && interactiveRe.test(n.name));
        if (isInteractive && n.width != null && n.height != null && (n.width < 44 || n.height < 44)) {
          issues.push({ rule: 'touch-target-size', node: _oc.summarize(n), msg: 'Touch target ' + Math.round(n.width) + '×' + Math.round(n.height) + ' < 44×44' });
        }
      }
      if (enabled('color-contrast') && n.type === 'TEXT') {
        const fg = firstSolid(n.fills);
        if (fg) {
          const bg = findBg(n);
          const r = ratio(fg, bg);
          const size = n.fontSize === figma.mixed ? 16 : n.fontSize;
          const min = size >= 24 ? 3 : 4.5;
          if (r < min) {
            issues.push({
              rule: 'color-contrast',
              node: _oc.summarize(n),
              msg: 'Contrast ' + r.toFixed(2) + ':1 < ' + min + ':1 (' + _oc.rgbToHex(fg) + ' on ' + _oc.rgbToHex(bg) + ')'
            });
          }
        }
      }
      if (enabled('layout-grid') && n.type === 'FRAME' && 'layoutMode' in n && n.layoutMode && n.layoutMode !== 'NONE') {
        const checkSpacing = (label, v) => {
          if (typeof v !== 'number' || !Number.isFinite(v)) return;
          const rounded = Math.round(v);
          if (Math.abs(v - rounded) > 0.01) return;
          if (rounded % 4 !== 0) {
            issues.push({
              rule: 'layout-grid',
              node: _oc.summarize(n),
              msg: label + ' ' + v + 'px is not a multiple of 4'
            });
          }
        };
        checkSpacing('itemSpacing', n.itemSpacing);
        if ('paddingLeft' in n) {
          checkSpacing('paddingLeft', n.paddingLeft);
          checkSpacing('paddingRight', n.paddingRight);
          checkSpacing('paddingTop', n.paddingTop);
          checkSpacing('paddingBottom', n.paddingBottom);
        }
      }
      if ('children' in n) for (const c of n.children) walk(c);
    };
    walk(root);
    return issues;
  })()`, ctx);
}

// ---------------------------------------------------------------------------
// Variables / collections / tokens
// ---------------------------------------------------------------------------

export async function listVariables(client, args = {}) {
  const ctx = { collection: args.collection || null };
  return await client.run(`(async () => {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const vars = await figma.variables.getLocalVariablesAsync();
    const colsById = new Map(cols.map(c => [c.id, c]));
    return vars
      .filter(v => !ctx.collection || (colsById.get(v.variableCollectionId)?.name === ctx.collection))
      .map(v => ({
        name: v.name,
        type: v.resolvedType,
        collection: colsById.get(v.variableCollectionId)?.name || '(unknown)'
      }));
  })()`, ctx);
}

export async function findVariables(client, args) {
  const ctx = { pattern: String(args.name || args.pattern || '') };
  return await client.run(`(async () => {
    const re = new RegExp(ctx.pattern.replace(/\\*/g, '.*'), 'i');
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const colsById = new Map(cols.map(c => [c.id, c]));
    const vars = await figma.variables.getLocalVariablesAsync();
    return vars
      .filter(v => re.test(v.name))
      .map(v => ({ name: v.name, type: v.resolvedType, collection: colsById.get(v.variableCollectionId)?.name }));
  })()`, ctx);
}

export async function createVariable(client, args) {
  if (!args.name) throw new Error('Variable name required');
  if (!args.collection) throw new Error('Collection required');
  const ctx = {
    name: args.name,
    collection: args.collection,
    type: (args.type || 'COLOR').toUpperCase(),
    value: args.value ?? null
  };
  return await client.run(`(async () => {
    const col = await _oc.ensureCollection(ctx.collection);
    const v = await _oc.ensureVariable(col, ctx.name, ctx.type);
    if (ctx.value !== null) {
      let resolved;
      if (ctx.type === 'COLOR') resolved = _oc.hexToRgb(ctx.value);
      else if (ctx.type === 'FLOAT') {
        let x = parseFloat(ctx.value);
        // FLOAT vars bound to node opacity use ~0–100 in Figma; literal 0.5 otherwise reads as 0.5%.
        if (Number.isFinite(x) && x > 0 && x <= 1 && String(ctx.name).toLowerCase().includes('opacity')) {
          x = x * 100;
        }
        resolved = x;
      }
      else if (ctx.type === 'BOOLEAN') resolved = String(ctx.value).toLowerCase() === 'true';
      else resolved = String(ctx.value);
      v.setValueForMode(col.modes[0].modeId, resolved);
    }
    return { name: v.name, type: v.resolvedType, collection: col.name };
  })()`, ctx);
}

export async function deleteAllVariables(client, args) {
  const ctx = { collection: args.collection || null };
  return await client.run(`(async () => {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const targets = ctx.collection ? cols.filter(c => c.name === ctx.collection) : cols;
    let varCount = 0;
    for (const col of targets) {
      const vars = await figma.variables.getLocalVariablesAsync();
      for (const v of vars.filter(v => v.variableCollectionId === col.id)) { v.remove(); varCount++; }
      col.remove();
    }
    return { collections: targets.length, variables: varCount };
  })()`, ctx);
}

export async function listCollections(client) {
  return await client.run(`(async () => {
    const cs = await figma.variables.getLocalVariableCollectionsAsync();
    return cs.map(c => ({ id: c.id, name: c.name, modes: c.modes.map(m => m.name) }));
  })()`);
}

export async function ensureCollection(client, args) {
  if (!args.name) throw new Error('Collection name required');
  const ctx = { name: args.name };
  return await client.run(`(async () => {
    const c = await _oc.ensureCollection(ctx.name);
    return { id: c.id, name: c.name, modes: c.modes.map(m => m.name) };
  })()`, ctx);
}

export async function deleteCollection(client, args) {
  if (!args.name) throw new Error('Collection name required');
  const ctx = { name: args.name };
  return await client.run(`(async () => {
    const cs = await figma.variables.getLocalVariableCollectionsAsync();
    const target = cs.filter(c => c.name === ctx.name);
    if (!target.length) throw new Error('No collection named ' + ctx.name);
    for (const c of target) c.remove();
    return { removed: target.length };
  })()`, ctx);
}

export async function addPreset(client, args) {
  const p = String(args.preset || '').toLowerCase();
  if (p === 'shadcn') {
    return await client.run(`(async () => {
      const col = await _oc.ensureCollection('shadcn');
      if (col.modes[0].name !== 'Light') col.renameMode(col.modes[0].modeId, 'Light');
      const lightMode = col.modes[0].modeId;
      const darkMode = _oc.ensureMode(col, 'Dark');
      const names = Array.from(new Set([...Object.keys(ctx.light), ...Object.keys(ctx.dark)]));
      for (const name of names) {
        const v = await _oc.ensureVariable(col, name, 'COLOR');
        if (ctx.light[name]) v.setValueForMode(lightMode, _oc.hexToRgb(ctx.light[name]));
        if (ctx.dark[name]) v.setValueForMode(darkMode, _oc.hexToRgb(ctx.dark[name]));
      }
      return { collections: 1, variables: names.length, preset: 'shadcn' };
    })()`, { light: SHADCN.light, dark: SHADCN.dark });
  }
  if (p === 'tailwind' || p === 'ds') {
    const tokens = p === 'tailwind' ? tailwindFlat() : dsFlat();
    const collectionName = p === 'tailwind' ? 'Tailwind' : 'DS Base';
    return await client.run(`(async () => {
      const col = await _oc.ensureCollection(ctx.collectionName);
      const modeId = col.modes[0].modeId;
      let count = 0;
      for (const name of Object.keys(ctx.tokens)) {
        const v = await _oc.ensureVariable(col, name, 'COLOR');
        v.setValueForMode(modeId, _oc.hexToRgb(ctx.tokens[name]));
        count++;
      }
      return { collections: 1, variables: count, preset: ctx.preset };
    })()`, { collectionName, tokens, preset: p });
  }
  throw new Error(`Unknown preset "${args.preset}". Use: shadcn | tailwind | ds`);
}

export async function visualizeTokens(client, args = {}) {
  const ctx = { collection: args.collection || args.filter || null };
  return await client.run(`(async () => {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const targetCols = ctx.collection
      ? cols.filter(c => c.name === ctx.collection || c.name.toLowerCase().includes(ctx.collection.toLowerCase()))
      : cols;
    if (!targetCols.length) throw new Error('No matching collections');
    const vars = await figma.variables.getLocalVariablesAsync('COLOR');
    const colsById = new Map(targetCols.map(c => [c.id, c]));
    const filtered = vars.filter(v => colsById.has(v.variableCollectionId));
    if (!filtered.length) throw new Error('No COLOR variables');

    await _oc.loadFont('Inter', 'Regular');
    const board = figma.createFrame();
    board.name = 'Token Visualization';
    board.layoutMode = 'VERTICAL';
    board.itemSpacing = 32;
    board.paddingLeft = 32; board.paddingRight = 32; board.paddingTop = 32; board.paddingBottom = 32;
    board.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    board.x = _oc.nextX(); board.y = 0;

    for (const col of targetCols) {
      const colVars = filtered.filter(v => v.variableCollectionId === col.id);
      if (!colVars.length) continue;
      const section = figma.createFrame();
      section.name = col.name;
      section.layoutMode = 'VERTICAL';
      section.itemSpacing = 12;
      section.fills = [];
      const heading = figma.createText();
      heading.characters = col.name + ' (' + colVars.length + ')';
      heading.fontSize = 18;
      section.appendChild(heading);
      const grid = figma.createFrame();
      grid.layoutMode = 'HORIZONTAL';
      grid.layoutWrap = 'WRAP';
      grid.itemSpacing = 16;
      grid.counterAxisSpacing = 16;
      grid.fills = [];
      for (const v of colVars) {
        const card = figma.createFrame();
        card.name = v.name;
        card.layoutMode = 'VERTICAL';
        card.itemSpacing = 8;
        card.resize(120, 152);
        card.fills = [];
        const swatch = figma.createRectangle();
        swatch.resize(120, 120);
        swatch.cornerRadius = 8;
        const base = { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } };
        swatch.fills = [figma.variables.setBoundVariableForPaint(base, 'color', v)];
        card.appendChild(swatch);
        const label = figma.createText();
        label.characters = v.name;
        label.fontSize = 11;
        card.appendChild(label);
        grid.appendChild(card);
      }
      section.appendChild(grid);
      board.appendChild(section);
    }
    figma.viewport.scrollAndZoomIntoView([board]);
    return { id: board.id, name: board.name, count: filtered.length };
  })()`, ctx);
}

// ---------------------------------------------------------------------------
// Node ops
// ---------------------------------------------------------------------------

export async function toComponent(client, args) {
  const ctx = { ids: (args.nodeIds || (args.nodeId ? [args.nodeId] : [])) };
  return await client.run(`(async () => {
    const countDescendants = (node) => {
      let count = 0;
      const walk = (x) => {
        if ('children' in x && x.children && x.children.length) {
          for (const ch of x.children) {
            count++;
            walk(ch);
          }
        }
      };
      walk(node);
      return count;
    };
    let nodes;
    if (ctx.ids && ctx.ids.length) {
      nodes = (await Promise.all(ctx.ids.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    } else {
      nodes = figma.currentPage.selection.slice();
    }
    if (!nodes.length) throw new Error('No nodes (provide nodeIds or select in Figma first)');
    const out = [];
    for (const n of nodes) {
      if (n.type === 'COMPONENT') { out.push(n); continue; }
      if ((n.type === 'FRAME' || n.type === 'GROUP') && countDescendants(n) === 0) {
        throw new Error(
          'Refusing to convert an empty frame/group ("' + n.name + '") to a component. ' +
            'Use figma_recipe recipe=input|button or figma_component action=create-set with JSX that includes children (e.g. <Text name="Placeholder">…</Text>).'
        );
      }
      if (figma.createComponentFromNode) { out.push(figma.createComponentFromNode(n)); continue; }
      const c = figma.createComponent();
      c.resize(n.width, n.height); c.x = n.x; c.y = n.y; c.name = n.name;
      n.parent.appendChild(c); c.appendChild(n); n.x = 0; n.y = 0;
      out.push(c);
    }
    return out.map(_oc.summarize);
  })()`, ctx);
}

export async function deleteNodes(client, args) {
  const ctx = { ids: args.nodeIds || (args.nodeId ? [args.nodeId] : []) };
  return await client.run(`(async () => {
    let nodes;
    if (ctx.ids && ctx.ids.length) {
      nodes = (await Promise.all(ctx.ids.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    } else {
      nodes = figma.currentPage.selection.slice();
    }
    const removed = nodes.length;
    for (const n of nodes) n.remove();
    return { removed };
  })()`, ctx);
}

export async function groupNodes(client, args) {
  const ctx = { ids: args.nodeIds || (args.nodeId ? [args.nodeId] : []) };
  return await client.run(`(async () => {
    let nodes;
    if (ctx.ids && ctx.ids.length) {
      nodes = (await Promise.all(ctx.ids.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    } else {
      nodes = figma.currentPage.selection.slice();
    }
    if (!nodes.length) throw new Error('Select at least 1 node');
    const g = figma.group(nodes, nodes[0].parent);
    return _oc.summarize(g);
  })()`, ctx);
}

export async function ungroupNodes(client, args) {
  const ctx = { ids: args.nodeIds || (args.nodeId ? [args.nodeId] : []) };
  return await client.run(`(async () => {
    let nodes;
    if (ctx.ids && ctx.ids.length) {
      nodes = (await Promise.all(ctx.ids.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    } else {
      nodes = figma.currentPage.selection.slice();
    }
    let count = 0;
    for (const n of nodes) {
      if (n.type === 'GROUP' || n.type === 'FRAME') {
        const parent = n.parent;
        const children = n.children.slice();
        for (const c of children) parent.appendChild(c);
        n.remove();
        count++;
      }
    }
    return { ungrouped: count };
  })()`, ctx);
}

// ---------------------------------------------------------------------------
// Components, variants, instances
// ---------------------------------------------------------------------------

// Create a single component from a JSX tree.
export async function createComponent(client, args) {
  const nm = coerceDisplayName(args.name, '');
  if (!nm) throw new Error('Component name required (must be a non-empty string — not boolean true)');
  const trees = parseJSX(args.jsx);
  if (trees.length !== 1) throw new Error('Component JSX must produce exactly one root element');
  const ctx = { name: nm, tree: trees[0] };
  return await client.run(`(async () => {
    const countVisibleDescendants = (node) => {
      let count = 0;
      const walk = (n) => {
        if ('children' in n && n.children && n.children.length) {
          for (const ch of n.children) {
            count++;
            walk(ch);
          }
        }
      };
      walk(node);
      return count;
    };
    ${RENDERER}
    const root = await renderTree(ctx.tree, null);
    figma.currentPage.appendChild(root);
    const comp = figma.createComponentFromNode ? figma.createComponentFromNode(root) : (() => {
      const c = figma.createComponent();
      c.resize(root.width || 100, root.height || 100);
      c.x = root.x; c.y = root.y; c.name = root.name;
      root.parent.appendChild(c); c.appendChild(root); root.x = 0; root.y = 0;
      return c;
    })();
    comp.name = ctx.name;
    comp.x = _oc.nextX();
    comp.y = 0;
    if (!countVisibleDescendants(comp)) {
      throw new Error(
        'Component "' + ctx.name + '" has no content after render — JSX is likely empty/invalid. ' +
        'Ensure children exist (e.g. <Text name="Label">…</Text>) or use figma_recipe recipe=button|input.'
      );
    }
    figma.viewport.scrollAndZoomIntoView([comp]);
    return _oc.summarize(comp);
  })()`, ctx);
}

// Create a component SET (variants). Each variant has its own JSX and a
// "properties" object like { State: 'Default', Size: 'Lg' }. The variant frame
// will be named "State=Default, Size=Lg" so Figma exposes those as variant
// properties on the resulting set.
export async function createComponentSet(client, args) {
  const setNm = coerceDisplayName(args.name, '');
  if (!setNm) throw new Error('Set name required (must be a string — boolean true yields invalid names)');
  if (!Array.isArray(args.variants) || !args.variants.length) {
    throw new Error('Provide variants: [{ properties: { State: "Default" }, jsx: "<Frame .../>" }]');
  }
  const variants = args.variants.map((v, i) => {
    const props = v.properties || v.props || {};
    const variantName = Object.keys(props).length
      ? Object.entries(props).map(([k, val]) => `${k}=${val}`).join(', ')
      : `Variant ${i + 1}`;
    const trees = parseJSX(v.jsx);
    if (trees.length !== 1) throw new Error(`Variant ${i + 1}: JSX must produce exactly one root element`);
    return { name: variantName, tree: trees[0] };
  });
  const ctx = { name: setNm, variants };
  return await client.run(`(async () => {
    ${RENDERER}
    const components = [];
    for (const v of ctx.variants) {
      const root = await renderTree(v.tree, null);
      figma.currentPage.appendChild(root);
      const c = figma.createComponentFromNode ? figma.createComponentFromNode(root) : (() => {
        const cc = figma.createComponent();
        cc.resize(root.width || 100, root.height || 100);
        root.parent.appendChild(cc); cc.appendChild(root); root.x = 0; root.y = 0;
        return cc;
      })();
      c.name = v.name;
      components.push(c);
    }
    const countVisibleDescendants = (node) => {
      let count = 0;
      const walk = (n) => {
        if ('children' in n && n.children && n.children.length) {
          for (const ch of n.children) {
            count++;
            walk(ch);
          }
        }
      };
      walk(node);
      return count;
    };

    const set = figma.combineAsVariants(components, figma.currentPage);
    set.name = ctx.name;
    set.layoutMode = 'HORIZONTAL';
    set.itemSpacing = 24;
    set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 24;
    set.primaryAxisSizingMode = 'AUTO';
    set.counterAxisSizingMode = 'AUTO';
    set.x = _oc.nextX();
    set.y = 0;
    figma.viewport.scrollAndZoomIntoView([set]);
    const variantSummaries = [];
    for (const c of set.children) {
      const desc = countVisibleDescendants(c);
      if (!desc) {
        throw new Error(
          'Variant "' + c.name + '" rendered with no descendants — JSX likely empty or invalid. ' +
          'Use figma_component action=create-set with proper JSX children (e.g. <Text name="Label">…</Text>), ' +
          'or figma_recipe recipe=input|button for a deterministic component set.'
        );
      }
      variantSummaries.push({ id: c.id, name: c.name });
    }
    return {
      ..._oc.summarize(set),
      variants: variantSummaries
    };
  })()`, ctx);
}

export async function listComponents(client) {
  return await client.run(`(async () => {
    const out = [];
    const walk = (n) => {
      if (n.type === 'COMPONENT_SET') {
        out.push({
          id: n.id, name: n.name, type: 'COMPONENT_SET',
          variants: n.children.map(c => ({ id: c.id, name: c.name }))
        });
      } else if (n.type === 'COMPONENT' && (!n.parent || n.parent.type !== 'COMPONENT_SET')) {
        out.push({ id: n.id, name: n.name, type: 'COMPONENT', variants: [] });
      }
      if ('children' in n) for (const c of n.children) walk(c);
    };
    walk(figma.root);
    return out;
  })()`);
}

export async function createInstance(client, args) {
  if (!args.component) throw new Error('component (name or id) required');
  const ctx = {
    component: args.component,
    variant: args.variant || null,
    overrides: args.overrides || null
  };
  return await client.run(`(async () => {
    const inst = await _oc.instantiate(ctx.component, { variant: ctx.variant, overrides: ctx.overrides });
    inst.x = _oc.nextX();
    inst.y = 0;
    figma.currentPage.appendChild(inst);
    figma.currentPage.selection = [inst];
    figma.viewport.scrollAndZoomIntoView([inst]);
    return _oc.summarize(inst);
  })()`, ctx);
}

// ---------------------------------------------------------------------------
// Text styles
// ---------------------------------------------------------------------------

export async function listTextStyles(client) {
  return await client.run(`(async () => {
    const styles = await figma.getLocalTextStylesAsync();
    return styles.map(s => ({
      id: s.id,
      name: s.name,
      fontFamily: s.fontName?.family,
      fontStyle: s.fontName?.style,
      fontSize: s.fontSize,
      lineHeight: typeof s.lineHeight === 'object' ? s.lineHeight.value + (s.lineHeight.unit === 'PERCENT' ? '%' : 'px') : s.lineHeight
    }));
  })()`);
}

export async function createTextStyle(client, args) {
  if (!args.name) throw new Error('Text style name required');
  const ctx = {
    name: args.name,
    family: args.family || 'Inter',
    style: args.style || 'Regular',
    size: Number(args.size || 14),
    lineHeight: args.lineHeight ?? null,
    letterSpacing: args.letterSpacing ?? null
  };
  return await client.run(`(async () => {
    await _oc.loadFont(ctx.family, ctx.style);
    const existing = (await figma.getLocalTextStylesAsync()).find(s => s.name === ctx.name);
    const s = existing || figma.createTextStyle();
    s.name = ctx.name;
    s.fontName = { family: ctx.family, style: ctx.style };
    s.fontSize = ctx.size;
    if (ctx.lineHeight != null) {
      const lh = String(ctx.lineHeight);
      if (lh.endsWith('%')) s.lineHeight = { value: parseFloat(lh), unit: 'PERCENT' };
      else if (lh === 'auto') s.lineHeight = { unit: 'AUTO' };
      else s.lineHeight = { value: parseFloat(lh), unit: 'PIXELS' };
    }
    if (ctx.letterSpacing != null) s.letterSpacing = { value: Number(ctx.letterSpacing), unit: 'PIXELS' };
    return { id: s.id, name: s.name };
  })()`, ctx);
}

// ---------------------------------------------------------------------------
// Effect styles (drop shadow, blur)
// ---------------------------------------------------------------------------

export async function listEffectStyles(client) {
  return await client.run(`(async () => {
    const styles = await figma.getLocalEffectStylesAsync();
    return styles.map(s => ({ id: s.id, name: s.name, effects: s.effects.length }));
  })()`);
}

export async function createEffectStyle(client, args) {
  if (!args.name) throw new Error('Effect style name required');
  const t = String(args.type || 'shadow').toLowerCase();
  const ctx = {
    name: args.name,
    type: t,
    color: args.color || '#000000',
    opacity: args.opacity != null ? Number(args.opacity) : 0.15,
    x: args.x != null ? Number(args.x) : 0,
    y: args.y != null ? Number(args.y) : 4,
    blur: args.blur != null ? Number(args.blur) : 8,
    spread: args.spread != null ? Number(args.spread) : 0
  };
  return await client.run(`(async () => {
    const existing = (await figma.getLocalEffectStylesAsync()).find(s => s.name === ctx.name);
    const s = existing || figma.createEffectStyle();
    s.name = ctx.name;
    const c = _oc.hexToRgb(ctx.color);
    let effect;
    if (ctx.type === 'shadow' || ctx.type === 'drop-shadow') {
      effect = {
        type: 'DROP_SHADOW',
        color: { r: c.r, g: c.g, b: c.b, a: ctx.opacity },
        offset: { x: ctx.x, y: ctx.y },
        radius: ctx.blur,
        spread: ctx.spread,
        visible: true,
        blendMode: 'NORMAL'
      };
    } else if (ctx.type === 'inner' || ctx.type === 'inner-shadow') {
      effect = {
        type: 'INNER_SHADOW',
        color: { r: c.r, g: c.g, b: c.b, a: ctx.opacity },
        offset: { x: ctx.x, y: ctx.y },
        radius: ctx.blur,
        spread: ctx.spread,
        visible: true,
        blendMode: 'NORMAL'
      };
    } else if (ctx.type === 'blur') {
      effect = { type: 'LAYER_BLUR', radius: ctx.blur, visible: true };
    } else if (ctx.type === 'background-blur' || ctx.type === 'bg-blur') {
      effect = { type: 'BACKGROUND_BLUR', radius: ctx.blur, visible: true };
    } else {
      throw new Error('Unknown effect type: ' + ctx.type);
    }
    s.effects = [effect];
    return { id: s.id, name: s.name };
  })()`, ctx);
}

// ---------------------------------------------------------------------------
// Layout sizing helpers (FILL / HUG / FIXED for existing nodes)
// ---------------------------------------------------------------------------

export async function setLayoutSizing(client, args) {
  const ctx = {
    nodeId: args.nodeId || null,
    nodeIds: args.nodeIds || null,
    horizontal: args.horizontal ? String(args.horizontal).toUpperCase() : null,
    vertical: args.vertical ? String(args.vertical).toUpperCase() : null
  };
  return await client.run(`(async () => {
    let nodes;
    if (ctx.nodeIds && ctx.nodeIds.length) {
      nodes = (await Promise.all(ctx.nodeIds.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    } else {
      const single = await _oc.getNode(ctx.nodeId);
      nodes = single ? [single] : figma.currentPage.selection.slice();
    }
    if (!nodes.length) throw new Error('No nodes (provide nodeId/nodeIds or select something)');
    const validH = ['FILL', 'HUG', 'FIXED'];
    const validV = ['FILL', 'HUG', 'FIXED'];
    let count = 0;
    for (const n of nodes) {
      if (ctx.horizontal && validH.includes(ctx.horizontal) && 'layoutSizingHorizontal' in n) {
        n.layoutSizingHorizontal = ctx.horizontal; count++;
      }
      if (ctx.vertical && validV.includes(ctx.vertical) && 'layoutSizingVertical' in n) {
        n.layoutSizingVertical = ctx.vertical;
      }
    }
    return { applied: count };
  })()`, ctx);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const FORMATS = {
  png: { format: 'PNG', binary: true, ext: 'png' },
  jpg: { format: 'JPG', binary: true, ext: 'jpg' },
  jpeg: { format: 'JPG', binary: true, ext: 'jpg' },
  svg: { format: 'SVG', binary: false, ext: 'svg' },
  pdf: { format: 'PDF', binary: true, ext: 'pdf' }
};

export async function exportNode(client, args) {
  const fmt = String(args.format || '').toLowerCase();
  const cfg = FORMATS[fmt];
  if (!cfg) throw new Error(`Unsupported format "${args.format}". Use: ${Object.keys(FORMATS).join(', ')}`);
  const ctx = {
    format: cfg.format,
    nodeId: args.nodeId || null,
    scale: args.scale != null ? Number(args.scale) : 1
  };
  const r = await client.run(`(async () => {
    const node = await _oc.getNode(ctx.nodeId);
    if (!node) throw new Error('No node selected and no nodeId provided');
    const settings = ctx.format === 'SVG'
      ? { format: 'SVG_STRING' }
      : { format: ctx.format, constraint: { type: 'SCALE', value: ctx.scale || 1 } };
    const data = await node.exportAsync(settings);
    let payload, encoding;
    if (typeof data === 'string') { payload = data; encoding = 'utf8'; }
    else {
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < data.length; i += chunk) bin += String.fromCharCode.apply(null, data.subarray(i, i + chunk));
      payload = btoa(bin); encoding = 'base64';
    }
    return { name: node.name, id: node.id, payload, encoding };
  })()`, ctx);
  return { ...r, ext: cfg.ext };
}

// ---------------------------------------------------------------------------
// Render (JSX)
// ---------------------------------------------------------------------------

const RENDERER = `
const TEXT_TAGS = new Set(['text','span','p','h1','h2','h3','h4','label']);
const FRAME_TAGS = new Set(['frame','group','box','div','stack','vstack','hstack','row','col','column']);

const renderTree = async (tree, parent) => {
  const { tag, props, children } = tree;
  const t = String(tag).toLowerCase();
  let node;
  let isInstance = false;

  if (FRAME_TAGS.has(t)) {
    node = figma.createFrame();
    node.fills = [];
  } else if (t === 'rect' || t === 'rectangle') {
    node = figma.createRectangle();
  } else if (t === 'ellipse' || t === 'circle') {
    node = figma.createEllipse();
  } else if (TEXT_TAGS.has(t)) {
    const fontFamily = props.font || 'Inter';
    const weight = props.weight;
    const styleMap = {
      bold: 'Bold',
      medium: 'Medium',
      semibold: 'Semi Bold',
      'semi-bold': 'Semi Bold',
      light: 'Light',
      regular: 'Regular'
    };
    const style = weight ? (styleMap[String(weight).toLowerCase()] || 'Regular') : 'Regular';
    const f = await _oc.loadFont(fontFamily, style);
    node = figma.createText();
    node.fontName = f;
    const text = (children || []).find(c => typeof c === 'string') || '';
    node.characters = text;
    if (props.size != null) await _oc.applyScalarBinding(node, 'fontSize', props.size);
    else if (t === 'h1') node.fontSize = 32;
    else if (t === 'h2') node.fontSize = 24;
    else if (t === 'h3') node.fontSize = 18;
    else if (t === 'h4') node.fontSize = 16;
    if (props.color != null) await _oc.applyFill(node, props.color);
  } else if (t === 'instance') {
    if (!props.component) throw new Error('<Instance> requires a "component" prop');
    const overrides = {};
    for (const [k, v] of Object.entries(props)) {
      if (k === 'component' || k === 'variant' || k === 'name' ||
          k === 'w' || k === 'h' || k === 'width' || k === 'height' ||
          k === 'flex' || k === 'gap' || k === 'p' || k === 'px' || k === 'py' ||
          k === 'pl' || k === 'pr' || k === 'pt' || k === 'pb' ||
          k === 'justify' || k === 'items' || k === 'opacity' ||
          k === 'bg' || k === 'fill' || k === 'stroke' || k === 'strokeWidth' || k === 'rounded' ||
          k === 'wrap' || k === 'rowGap' || k === 'crossGap' ||
          k === 'grow' || k === 'alignSelf' || k === 'minW' || k === 'minH' || k === 'maxW' || k === 'maxH') continue;
      overrides[k] = v;
    }
    const textChild = (children || []).find(c => typeof c === 'string');
    if (textChild && !overrides.Label && !overrides.label && !overrides.Text && !overrides.text) {
      overrides.Label = textChild;
    }
    node = await _oc.instantiate(props.component, { variant: props.variant, overrides });
    isInstance = true;
  } else {
    throw new Error('Unknown tag "' + tag + '". Use: Frame, Stack, HStack, VStack, Text, Rect, Ellipse, Instance');
  }

  const capTag = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Frame');
  const pn = props.name;
  if (pn != null && typeof pn !== 'boolean') {
    const ns = String(pn).trim();
    if (ns) node.name = ns;
    else if (!isInstance) node.name = capTag(tag);
  } else if (!isInstance) node.name = capTag(tag);

  // Map tag aliases → flex direction (so the AI can use semantic stacks).
  let inferredFlex = props.flex;
  if (!inferredFlex) {
    if (t === 'hstack' || t === 'row') inferredFlex = 'row';
    else if (t === 'vstack' || t === 'col' || t === 'column' || t === 'stack') inferredFlex = 'col';
  }

  if (inferredFlex && 'layoutMode' in node && node.type !== 'INSTANCE') {
    node.layoutMode = inferredFlex === 'row' ? 'HORIZONTAL' : 'VERTICAL';
    if (props.gap != null) await _oc.applyScalarBinding(node, 'itemSpacing', props.gap);
    if (props.p != null) {
      await _oc.applyScalarBinding(node, 'paddingLeft', props.p);
      await _oc.applyScalarBinding(node, 'paddingRight', props.p);
      await _oc.applyScalarBinding(node, 'paddingTop', props.p);
      await _oc.applyScalarBinding(node, 'paddingBottom', props.p);
    }
    if (props.px != null) {
      await _oc.applyScalarBinding(node, 'paddingLeft', props.px);
      await _oc.applyScalarBinding(node, 'paddingRight', props.px);
    }
    if (props.py != null) {
      await _oc.applyScalarBinding(node, 'paddingTop', props.py);
      await _oc.applyScalarBinding(node, 'paddingBottom', props.py);
    }
    if (props.pl != null) await _oc.applyScalarBinding(node, 'paddingLeft', props.pl);
    if (props.pr != null) await _oc.applyScalarBinding(node, 'paddingRight', props.pr);
    if (props.pt != null) await _oc.applyScalarBinding(node, 'paddingTop', props.pt);
    if (props.pb != null) await _oc.applyScalarBinding(node, 'paddingBottom', props.pb);

    const align = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };
    if (props.justify && align[props.justify]) node.primaryAxisAlignItems = align[props.justify];
    if (props.items && align[props.items]) node.counterAxisAlignItems = align[props.items];

    if (props.wrap === true || props.wrap === 'wrap' || props.wrap === 'true') {
      if ('layoutWrap' in node) node.layoutWrap = 'WRAP';
    } else if (props.wrap === false || props.wrap === 'nowrap' || props.wrap === 'no-wrap') {
      if ('layoutWrap' in node) node.layoutWrap = 'NO_WRAP';
    }
    const cGap = props.rowGap != null ? props.rowGap : props.crossGap;
    if (cGap != null && 'counterAxisSpacing' in node) {
      await _oc.applyScalarBinding(node, 'counterAxisSpacing', cGap);
    }

    // Default to HUG so frames don't get clipped to their initial 100×100.
    if ('primaryAxisSizingMode' in node) node.primaryAxisSizingMode = 'AUTO';
    if ('counterAxisSizingMode' in node) node.counterAxisSizingMode = 'AUTO';
  }

  let w = props.w != null ? props.w : props.width;
  let h = props.h != null ? props.h : props.height;
  const fillW = w === 'fill' || w === '100%';
  const fillH = h === 'fill' || h === '100%';
  const hugW = w === 'hug' || w === 'auto';
  const hugH = h === 'hug' || h === 'auto';
  if (fillW || hugW) w = null;
  if (fillH || hugH) h = null;

  if (typeof node.resize === 'function' && (w != null || h != null) && node.type !== 'INSTANCE') {
    const W = w != null ? Number(w) : (node.width || 100);
    const H = h != null ? Number(h) : (node.height || 100);
    if (W > 0 && H > 0) node.resize(W, H);
  }

  if (parent) parent.appendChild(node);

  // Apply layout sizing hints (FILL / HUG) once the node has a parent that supports auto-layout.
  if (parent && parent.layoutMode && parent.layoutMode !== 'NONE') {
    if (fillW && 'layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'FILL';
    else if (hugW && 'layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'HUG';
    if (fillH && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'FILL';
    else if (hugH && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'HUG';

    const selfAlign = { start: 'MIN', center: 'CENTER', end: 'MAX', stretch: 'STRETCH', baseline: 'BASELINE' };
    const as = props.alignSelf != null ? String(props.alignSelf).toLowerCase() : null;
    if (as && selfAlign[as] != null && 'layoutAlign' in node) node.layoutAlign = selfAlign[as];

    if (props.grow != null && 'layoutGrow' in node) {
      let g = props.grow;
      if (g === true) g = 1;
      if (g === false) g = 0;
      g = Number(g);
      if (Number.isFinite(g)) node.layoutGrow = Math.max(0, g);
    }

    const setMinMax = (key, prop) => {
      if (!(key in node) || props[prop] == null) return;
      const v = Number(props[prop]);
      if (Number.isFinite(v) && v >= 0) node[key] = v;
    };
    setMinMax('minWidth', 'minW');
    setMinMax('maxWidth', 'maxW');
    setMinMax('minHeight', 'minH');
    setMinMax('maxHeight', 'maxH');
  }

  if (!isInstance) {
    if (props.bg != null && !TEXT_TAGS.has(t)) await _oc.applyFill(node, props.bg);
    if (props.fill != null && !TEXT_TAGS.has(t)) await _oc.applyFill(node, props.fill);
    if (props.stroke != null) {
      const sw = props.strokeWidth != null && props.strokeWidth !== '' ? props.strokeWidth : 1;
      await _oc.applyStroke(node, props.stroke, sw);
    } else if (props.strokeWidth != null && props.strokeWidth !== '') {
      await _oc.applyScalarBinding(node, 'strokeWeight', props.strokeWidth);
    }
    if (props.rounded != null && 'cornerRadius' in node) await _oc.applyScalarBinding(node, 'cornerRadius', props.rounded);
  }
  if (props.opacity != null) await _oc.applyScalarBinding(node, 'opacity', props.opacity);

  if (!isInstance && !TEXT_TAGS.has(t) && children) {
    for (const c of children) {
      if (typeof c === 'string') continue;
      await renderTree(c, node);
    }
  }
  return node;
};
`;

export async function renderJSX(client, jsx) {
  const trees = parseJSX(jsx);
  if (!trees.length) throw new Error('No JSX elements parsed (got: ' + jsx.slice(0, 60).replace(/\n/g, ' ') + ')');
  const ctx = { trees };
  return await client.run(`(async () => {
    ${RENDERER}
    const created = [];
    let baseX = _oc.nextX();
    const gap = 100;
    for (const tree of ctx.trees) {
      const node = await renderTree(tree, null);
      figma.currentPage.appendChild(node);
      node.x = baseX;
      node.y = 0;
      baseX += (node.width || 0) + gap;
      created.push(_oc.summarize(node));
    }
    const ids = created.map(s => s.id);
    const fresh = (await Promise.all(ids.map(id => figma.getNodeByIdAsync(id)))).filter(Boolean);
    if (fresh.length) {
      figma.viewport.scrollAndZoomIntoView(fresh);
      figma.currentPage.selection = fresh;
    }
    return created;
  })()`, ctx);
}

// JSX parser (Node-side). Public so tests / debug can call it.
export function parseJSX(src) {
  src = String(src).trim();
  let pos = 0;

  const peek = (n = 0) => src[pos + n];
  const eof = () => pos >= src.length;
  const skipWS = () => { while (!eof() && /\s/.test(peek())) pos++; };

  const readIdent = () => {
    let s = '';
    while (!eof() && /[a-zA-Z0-9_-]/.test(peek())) s += src[pos++];
    return s;
  };

  const parseValue = () => {
    if (peek() === '"' || peek() === "'") {
      const q = src[pos++];
      let v = '';
      while (!eof() && peek() !== q) {
        if (peek() === '\\' && pos + 1 < src.length) { v += src[pos + 1]; pos += 2; }
        else v += src[pos++];
      }
      pos++;
      return v;
    }
    if (peek() === '{') {
      pos++;
      let depth = 1, raw = '';
      while (!eof() && depth > 0) {
        const c = peek();
        if (c === '{') { depth++; raw += src[pos++]; }
        else if (c === '}') { depth--; if (depth === 0) { pos++; break; } raw += src[pos++]; }
        else raw += src[pos++];
      }
      const v = raw.trim();
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (v === 'null') return null;
      if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
      const m = v.match(/^[`"'](.*)[`"']$/s);
      if (m) return m[1];
      return v;
    }
    return true;
  };

  const parseElement = () => {
    skipWS();
    if (peek() !== '<') return null;
    // Skip JSX comments {/* ... */}
    pos++;
    const tag = readIdent();
    if (!tag) throw new Error('Expected tag name at position ' + pos);
    const props = {};
    // Props that should never be "bare" booleans; require an explicit value.
    // This prevents accidental `name`/`component` becoming `true` when the model outputs `<Frame name ...>`.
    const REQUIRE_VALUE = new Set([
      'name',
      'component',
      'variant',
      'bg',
      'fill',
      'stroke',
      'color',
      'font',
      'icon'
    ]);
    while (!eof()) {
      skipWS();
      if (peek() === '/' || peek() === '>') break;
      const name = readIdent();
      if (!name) { pos++; continue; }
      if (peek() === '=') {
        pos++;
        const val = parseValue();
        if (REQUIRE_VALUE.has(name) && typeof val === 'boolean') {
          throw new Error(
            `Prop "${name}" on <${tag}> cannot be a boolean (e.g. avoid name={true}). Use a string: ${name}="Input".`
          );
        }
        props[name] = val;
      } else {
        if (REQUIRE_VALUE.has(name)) {
          throw new Error(`Prop "${name}" on <${tag}> must have a value (e.g. ${name}="...")`);
        }
        props[name] = true;
      }
    }
    if (peek() === '/') { pos += 2; return { tag, props, children: [] }; }
    pos++;
    const children = [];
    while (!eof()) {
      if (src.substr(pos, 2) === '</') {
        pos += 2;
        readIdent();
        skipWS();
        if (peek() === '>') pos++;
        break;
      }
      // skip {/* JSX comments */}
      if (peek() === '{' && src.substr(pos, 4) === '{/* ') {
        pos += 4;
        while (!eof() && src.substr(pos, 3) !== '*/}') pos++;
        if (!eof()) pos += 3;
        continue;
      }
      if (peek() === '<') {
        const child = parseElement();
        if (child) children.push(child);
      } else {
        let text = '';
        while (!eof() && peek() !== '<') text += src[pos++];
        text = text.replace(/\s+/g, ' ').trim();
        if (text) children.push(text);
      }
    }
    return { tag, props, children };
  };

  const trees = [];
  skipWS();
  let isBatch = false;
  if (peek() === '[') { isBatch = true; pos++; }
  while (!eof()) {
    skipWS();
    if (isBatch && peek() === ']') { pos++; break; }
    if (peek() !== '<') break;
    const t = parseElement();
    if (!t) break;
    trees.push(t);
    skipWS();
    if (peek() === ',') pos++;
  }
  return trees;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Models often emit name=true (boolean); never use as Figma layer name ("true"). */
export function coerceDisplayName(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw === 'boolean') return fallback;
  const s = String(raw).trim();
  return s || fallback;
}
