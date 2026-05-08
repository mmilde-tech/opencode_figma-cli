// Validators: read-only-ish checks that return actionable issues.
// (Implementation uses CDP eval but does not mutate document state.)

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

