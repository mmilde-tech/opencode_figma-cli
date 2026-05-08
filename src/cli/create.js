import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { createNode } from '../core/operations.js';

export default async function createCommand(type, name, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const result = await createNode(client, {
      type, name,
      width: options.width,
      height: options.height,
      fill: options.fill,
      stroke: options.stroke,
      strokeWidth: options.strokeWidth,
      rounded: options.rounded,
      content: options.content,
      icon: options.icon
    });
    console.log(chalk.green(`✓ Created ${result.type} "${result.name}"`));
    console.log(chalk.gray(`  id: ${result.id}`));
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
