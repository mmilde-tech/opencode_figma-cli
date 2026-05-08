import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { listVariables, findVariables, createVariable, deleteAllVariables, visualizeTokens } from '../core/operations.js';

export default async function variableCommand(action, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const a = String(action || '').toLowerCase();

    if (a === 'list') {
      const list = await listVariables(client, { collection: options.collection });
      if (!list.length) {
        console.log(chalk.yellow('No variables found' + (options.collection ? ` in "${options.collection}"` : '')));
        return;
      }
      const byCol = {};
      for (const v of list) (byCol[v.collection] = byCol[v.collection] || []).push(v);
      console.log(chalk.green(`✓ ${list.length} variable(s)`));
      for (const [col, vars] of Object.entries(byCol)) {
        console.log(`\n${chalk.cyan(col)} ${chalk.gray(`(${vars.length})`)}`);
        for (const v of vars.slice(0, 100)) console.log(`  ${v.name} ${chalk.gray(v.type)}`);
        if (vars.length > 100) console.log(chalk.gray(`  ... and ${vars.length - 100} more`));
      }
    } else if (a === 'find') {
      const r = await findVariables(client, { name: options.name });
      if (!r.length) { console.log(chalk.yellow('No matches')); return; }
      console.log(chalk.green(`✓ ${r.length} match(es)`));
      for (const v of r) console.log(`  ${chalk.cyan(v.collection)} / ${v.name} ${chalk.gray(v.type)}`);
    } else if (a === 'create') {
      const r = await createVariable(client, { name: options.name, collection: options.collection, type: options.type, value: options.value });
      console.log(chalk.green(`✓ Created ${r.type} variable "${r.name}" in "${r.collection}"`));
    } else if (a === 'delete-all') {
      const r = await deleteAllVariables(client, { collection: options.collection });
      console.log(chalk.green(`✓ Deleted ${r.collections} collection(s) and ${r.variables} variable(s)`));
    } else if (a === 'visualize') {
      const r = await visualizeTokens(client, { collection: options.collection || options.filter });
      console.log(chalk.green(`✓ Visualized ${r.count} variable(s) → ${r.name}`));
    } else {
      throw new Error('Unknown action: ' + action);
    }
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
