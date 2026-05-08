import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { lint } from '../core/operations.js';

export default async function lintCommand(options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const issues = await lint(client, { rule: options.rule, nodeId: options.node });

    if (!issues.length) {
      console.log(chalk.green('✓ No lint issues'));
      return;
    }

    const byRule = {};
    for (const it of issues) (byRule[it.rule] = byRule[it.rule] || []).push(it);
    console.log(chalk.yellow(`⚠ ${issues.length} issue(s)`));
    for (const [rule, list] of Object.entries(byRule)) {
      console.log('\n' + chalk.cyan(rule) + chalk.gray(` (${list.length})`));
      for (const it of list.slice(0, 20)) {
        console.log(`  ${it.msg}`);
        console.log(chalk.gray(`    ${it.node.type} ${it.node.name} (${it.node.id})`));
      }
      if (list.length > 20) console.log(chalk.gray(`  ... and ${list.length - 20} more`));
    }
    process.exitCode = 1;
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
