import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { findNodes } from '../core/operations.js';

export default async function findCommand(pattern, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const matches = await findNodes(client, { pattern, type: options.type });
    if (!matches.length) {
      console.log(chalk.yellow(`No nodes match "${pattern}"${options.type ? ` (type=${options.type})` : ''}`));
      return;
    }
    console.log(chalk.green(`✓ ${matches.length} node(s)`));
    for (const n of matches) {
      const dim = n.width != null ? chalk.gray(`  ${Math.round(n.width)}×${Math.round(n.height)}`) : '';
      console.log(`  ${chalk.cyan(n.type.padEnd(12))} ${n.name}${dim}`);
      console.log(chalk.gray(`    id: ${n.id}`));
    }
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
