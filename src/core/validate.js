// Validators: read-only-ish checks that return actionable issues.
// (Implementation uses CDP eval but does not mutate document state.)

import { parseJSX } from './operations.js';

const TEXT_TAGS = new Set(['text', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'label']);

function walkJsxTree(node, visit) {
  if (typeof node === 'string') return;
  visit(node);
  for (const c of node.children || []) walkJsxTree(c, visit);
}

/**
 * Offline validation for figma_component create-set payloads (before CDP).
 * Catches parse errors and empty text nodes (common model mistake).
 */
export function validateCreateSetVariants(variants) {
  const issues = [];
  if (!Array.isArray(variants) || variants.length === 0) {
    issues.push({ kind: 'variants', message: 'variants must be a non-empty array' });
    return { ok: false, issues };
  }
  variants.forEach((v, i) => {
    const n = i + 1;
    if (!v || typeof v !== 'object') {
      issues.push({ kind: 'variant', message: `Variant ${n}: expected object` });
      return;
    }
    const jsx = v.jsx;
    if (typeof jsx !== 'string' || !jsx.trim()) {
      issues.push({ kind: 'jsx', message: `Variant ${n}: jsx must be a non-empty string` });
      return;
    }
    let trees;
    try {
      trees = parseJSX(jsx);
    } catch (e) {
      issues.push({ kind: 'parse', message: `Variant ${n}: ${e.message}` });
      return;
    }
    if (trees.length !== 1) {
      issues.push({ kind: 'jsx', message: `Variant ${n}: expected exactly one root JSX element` });
      return;
    }
    walkJsxTree(trees[0], (node) => {
      const tag = String(node.tag || '').toLowerCase();
      if (!TEXT_TAGS.has(tag)) return;
      const strings = (node.children || []).filter((c) => typeof c === 'string');
      const text = strings.join('').trim();
      if (!text) {
        issues.push({
          kind: 'text',
          message: `Variant ${n}: <${node.tag}> has no text content (avoid self-closing Text)`
        });
      }
    });
  });
  return { ok: issues.length === 0, issues };
}

export async function validateComponentSet(client, { name, requiredVariantProps = ['State', 'Size'], requiredTextNodes = ['Value'] }) {
  if (!name) throw new Error('name required');
  const ctx = { name, requiredVariantProps, requiredTextNodes };
  return await client.run(`(async () => {
    const issues = [];
    const walk = (n, out) => {
      if (n.type === 'COMPONENT_SET' && n.name === ctx.name) out.push(n);
      if ('children' in n) for (const c of n.children) walk(c, out);
    };
    const sets = [];
    walk(figma.root, sets);
    if (!sets.length) return { ok: false, issues: [{ kind: 'missing', message: 'No component set named ' + ctx.name }] };
    const set = sets[0];

    const parse = (spec) => {
      const out = {};
      for (const part of String(spec || '').split(',')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k && v) out[k] = v;
      }
      return out;
    };

    const seen = new Set();
    for (const v of set.children) {
      const props = parse(v.name);
      for (const k of ctx.requiredVariantProps) {
        if (!props[k]) issues.push({ kind: 'variant', message: 'Variant missing ' + k + ' in name: ' + v.name, node: _oc.summarize(v) });
      }
      const key = ctx.requiredVariantProps.map(k => k + '=' + (props[k] || '?')).join(',');
      if (seen.has(key)) issues.push({ kind: 'variant', message: 'Duplicate variant combo: ' + key, node: _oc.summarize(v) });
      seen.add(key);

      for (const tn of ctx.requiredTextNodes) {
        const found = v.findOne ? v.findOne(n => n.type === 'TEXT' && n.name === tn) : null;
        if (!found) issues.push({ kind: 'structure', message: 'Missing text node "' + tn + '" in variant: ' + v.name, node: _oc.summarize(v) });
      }
    }

    return { ok: issues.length === 0, issues, set: _oc.summarize(set), variants: set.children.length };
  })()`, ctx);
}

