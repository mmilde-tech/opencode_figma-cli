import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { analyzeColors, analyzeTypography, analyzeSpacing, canvasInfo } from '../core/operations.js';

export default async function analyzeCommand(type, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const t = String(type || '').toLowerCase();
    const ctx = { nodeId: options.node };

    if (t === 'colors') {
      const r = await analyzeColors(client, ctx);
      if (!r.length) { console.log(chalk.yellow('No solid colors found')); return; }
      console.log(chalk.green(`✓ ${r.length} unique color(s)`));
      for (const { hex, count } of r) console.log(`  ${chalk.bgHex(hex)('  ')} ${hex.padEnd(8)} ${chalk.gray(`× ${count}`)}`);
    } else if (t === 'typography') {
      const r = await analyzeTypography(client, ctx);
      if (!r.length) { console.log(chalk.yellow('No text nodes found')); return; }
      console.log(chalk.green(`✓ ${r.length} unique font style(s)`));
      for (const { font, count } of r) console.log(`  ${font} ${chalk.gray(`× ${count}`)}`);
    } else if (t === 'spacing') {
      const r = await analyzeSpacing(client, ctx);
      console.log(chalk.green('✓ Spacing analysis'));
      console.log(chalk.cyan('  Paddings:'));
      if (!r.paddings.length) console.log(chalk.gray('    (none)'));
      else for (const { px, count } of r.paddings) console.log(`    ${px}px ${chalk.gray(`× ${count}`)}`);
      console.log(chalk.cyan('  Auto-layout gaps:'));
      if (!r.gaps.length) console.log(chalk.gray('    (none)'));
      else for (const { px, count } of r.gaps) console.log(`    ${px}px ${chalk.gray(`× ${count}`)}`);
    } else if (t === 'canvas') {
      const i = await canvasInfo(client);
      console.log(chalk.green(`✓ ${i.page} (${i.children} top-level nodes, ${i.selection} selected)`));
    } else {
      throw new Error('Unknown analyze type: ' + type);
    }
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
