import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { canvasInfo, canvasList, canvasArrange, canvasZoom, canvasClear } from '../core/operations.js';

export default async function canvasCommand(action, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const a = String(action || '').toLowerCase();

    if (a === 'info') {
      const info = await canvasInfo(client);
      console.log(chalk.green('✓ Canvas info'));
      console.log(`  page: ${chalk.cyan(info.page)}`);
      console.log(`  top-level nodes: ${info.children}`);
      console.log(`  selected: ${info.selection}`);
      console.log(`  zoom: ${info.viewport.zoom.toFixed(2)}`);
      if (info.selectionDetails.length) {
        console.log(chalk.gray('  selection:'));
        for (const n of info.selectionDetails) console.log(chalk.gray(`    ${n.type} ${n.name} (${n.id})`));
      }
    } else if (a === 'list') {
      const nodes = await canvasList(client);
      if (!nodes.length) { console.log(chalk.yellow('No nodes on canvas')); return; }
      console.log(chalk.green(`✓ ${nodes.length} top-level node(s)`));
      for (const n of nodes) {
        console.log(`  ${chalk.cyan(n.type.padEnd(12))} ${n.name} ${chalk.gray(`(${Math.round(n.width)}×${Math.round(n.height)} @ ${Math.round(n.x)},${Math.round(n.y)})`)}`);
      }
    } else if (a === 'arrange') {
      const r = await canvasArrange(client, { layout: options.layout });
      console.log(chalk.green(`✓ Arranged ${r.count} node(s) in ${r.layout}`));
    } else if (a === 'zoom-fit' || a === 'zoom') {
      const r = await canvasZoom(client);
      console.log(chalk.green(`✓ Zoomed to fit ${r.count} node(s)`));
    } else if (a === 'clear') {
      const r = await canvasClear(client);
      console.log(chalk.green(`✓ Removed ${r.removed} node(s)`));
    } else {
      throw new Error('Unknown canvas action: ' + action);
    }
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
