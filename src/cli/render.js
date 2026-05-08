import chalk from 'chalk';
import { FigmaClient } from '../core/figma-client.js';
import { renderJSX } from '../core/operations.js';

export default async function renderCommand(jsx, options) {
  return renderImpl(jsx);
}

export async function renderBatchCommand(jsxArray, isBatch, options) {
  return renderImpl(jsxArray);
}

async function renderImpl(jsx) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const result = await renderJSX(client, jsx);
    console.log(chalk.green(`✓ Rendered ${result.length} node(s)`));
    for (const n of result) console.log(chalk.gray(`  ${n.type} ${n.name} (${n.id})`));
    return result;
  } catch (e) {
    console.error(chalk.red('Render failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}
