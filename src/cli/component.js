import chalk from 'chalk';
import { readFileSync } from 'fs';
import { FigmaClient } from '../core/figma-client.js';
import * as ops from '../core/operations.js';
import { validateCreateSetVariants } from '../core/validate.js';

function readStdinOrFile(pathOrDash) {
  const p = pathOrDash === undefined || pathOrDash === '' ? '-' : pathOrDash;
  if (p === '-') return readFileSync(0, 'utf8');
  return readFileSync(p, 'utf8');
}

function parseVariantPayload(raw) {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('Expected JSON array of { properties?, jsx }');
  return data;
}

export default async function componentCommand(action, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const a = String(action || '').toLowerCase();

    if (a === 'list') {
      const r = await ops.listComponents(client);
      if (!r.length) console.log(chalk.gray('No components in document.'));
      else {
        for (const co of r) {
          console.log(chalk.green(`${co.type === 'COMPONENT_SET' ? 'SET' : 'COMP'} ${co.name} (${co.id})`));
          for (const v of co.variants) console.log(chalk.gray(`  → ${v.name} (${v.id})`));
        }
      }
      return;
    }

    if (a === 'create') {
      const name = options.name;
      const jsx = options.jsx ? String(options.jsx) : readStdinOrFile(options.jsxFile || '-');
      if (!name) throw new Error('--name is required');
      if (!jsx.trim()) throw new Error('Provide --jsx or --jsx-file (or pipe JSX on stdin)');
      const r = await ops.createComponent(client, { name, jsx });
      console.log(chalk.green(`✓ Created component "${r.name}" (${r.id})`));
      return;
    }

    if (a === 'create-set' || a === 'createset') {
      const name = options.name;
      if (!name) throw new Error('--name is required');
      let variantsJson;
      if (options.variants) variantsJson = String(options.variants);
      else if (options.variantsFile) variantsJson = readStdinOrFile(options.variantsFile);
      else variantsJson = readStdinOrFile('-');
      const variants = parseVariantPayload(variantsJson);
      const chk = validateCreateSetVariants(variants);
      if (!chk.ok) {
        console.error(chalk.red('JSX variant validation failed:'));
        for (const it of chk.issues) console.error(chalk.red(`  [${it.kind}] ${it.message}`));
        process.exitCode = 1;
        return;
      }
      const r = await ops.createComponentSet(client, { name, variants });
      console.log(chalk.green(`✓ Created component set "${r.name}" (${r.id}) — ${r.variants.length} variant(s)`));
      for (const v of r.variants) console.log(chalk.gray(`  ${v.name} (${v.id})`));
      return;
    }

    if (a === 'instance') {
      if (!options.component) throw new Error('--component is required');
      let overrides = undefined;
      if (options.overrides) overrides = JSON.parse(options.overrides);
      else if (options.overridesFile) overrides = JSON.parse(readStdinOrFile(options.overridesFile));
      const r = await ops.createInstance(client, {
        component: options.component,
        variant: options.variant || undefined,
        overrides
      });
      console.log(chalk.green(`✓ Placed instance "${r.name}" (${r.id})`));
      return;
    }

    if (a === 'delete') {
      const ids = options.ids ? String(options.ids).split(/[\s,]+/).filter(Boolean) : [];
      const r = await ops.deleteNodes(client, { nodeIds: ids.length ? ids : undefined });
      console.log(chalk.green(`✓ Removed ${r.removed} node(s)`));
      return;
    }

    throw new Error(`Unknown action "${action}". Use: list | create | create-set | instance | delete`);
  } catch (e) {
    console.error(chalk.red('component failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
