import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { listCollections, ensureCollection, deleteCollection } from '../core/operations.js';

export default async function collectionCommand(action, name, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const a = String(action || '').toLowerCase();

    if (a === 'list') {
      const cols = await listCollections(client);
      if (!cols.length) { console.log(chalk.yellow('No collections')); return; }
      console.log(chalk.green(`✓ ${cols.length} collection(s)`));
      for (const c of cols) console.log(`  ${chalk.cyan(c.name)}  ${chalk.gray('modes: ' + c.modes.join(', '))}`);
    } else if (a === 'create') {
      const r = await ensureCollection(client, { name });
      console.log(chalk.green(`✓ Collection "${r.name}" ready (modes: ${r.modes.join(', ')})`));
    } else if (a === 'delete') {
      const r = await deleteCollection(client, { name });
      console.log(chalk.green(`✓ Deleted ${r.removed} collection(s)`));
    } else {
      throw new Error('Unknown collection action: ' + action);
    }
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
