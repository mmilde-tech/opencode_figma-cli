import chalk from 'chalk';
import ora from 'ora';
import { FigmaClient } from '../core/figma-client.js';

export default async function evalCommand(code, options) {
  const client = new FigmaClient();
  const spinner = ora('Executing code...').start();

  try {
    await client.connect();
    const result = await client.run(code);
    spinner.succeed('Code executed');
    if (result !== undefined && result !== null) {
      console.log(typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
    }
  } catch (e) {
    spinner.fail('Execution failed');
    console.error(chalk.red(e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
