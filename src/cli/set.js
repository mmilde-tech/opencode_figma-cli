import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { setProperty } from '../core/operations.js';

export default async function setCommand(property, value, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const result = await setProperty(client, { property, value, nodeId: options.node });
    console.log(chalk.green(`✓ Set ${property} = ${value}`));
    console.log(chalk.gray(`  ${result.type} ${result.name} (${result.id})`));
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
