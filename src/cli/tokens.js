import chalk from 'chalk';
import ora from 'ora';
import { FigmaClient } from '../core/figma-client.js';
import { addPreset } from '../core/operations.js';

export default async function tokensCommand(preset, options) {
  if (!preset) {
    console.log(chalk.yellow('Usage: tokens <preset>   (preset: shadcn | tailwind | ds)'));
    return;
  }
  const client = new FigmaClient();
  const spinner = ora(`Adding ${preset} tokens...`).start();
  try {
    await client.connect();
    const result = await addPreset(client, { preset });
    spinner.succeed(`Added ${preset} tokens`);
    console.log(chalk.gray(`  collections: ${result.collections}, variables: ${result.variables}`));
  } catch (e) {
    spinner.fail('Failed to add tokens');
    console.error(chalk.red(e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
