import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { toComponent, deleteNodes, groupNodes, ungroupNodes } from '../core/operations.js';

export default async function nodeCommand(action, args, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const a = String(action || '').toLowerCase();
    const ids = (args || []).filter(Boolean);

    if (a === 'to-component') {
      const r = await toComponent(client, { nodeIds: ids });
      console.log(chalk.green(`✓ Converted ${r.length} node(s) to components`));
      for (const c of r) console.log(chalk.gray(`  ${c.name} (${c.id})`));
    } else if (a === 'delete') {
      const r = await deleteNodes(client, { nodeIds: ids });
      console.log(chalk.green(`✓ Removed ${r.removed} node(s)`));
    } else if (a === 'group') {
      const r = await groupNodes(client, { nodeIds: ids });
      console.log(chalk.green(`✓ Grouped → ${r.name} (${r.id})`));
    } else if (a === 'ungroup') {
      const r = await ungroupNodes(client, { nodeIds: ids });
      console.log(chalk.green(`✓ Ungrouped ${r.ungrouped} node(s)`));
    } else {
      throw new Error('Unknown node action: ' + action);
    }
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
