import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { Buffer } from 'buffer';
import { FigmaClient } from '../core/figma-client.js';
import { exportNode } from '../core/operations.js';

export default async function exportCommand(format, nodeId, options) {
  const client = new FigmaClient();
  try {
    await client.connect();
    const r = await exportNode(client, { format, nodeId, scale: options.scale });
    const out = resolve(options.output || `${sanitize(r.name)}.${r.ext}`);
    if (r.encoding === 'base64') writeFileSync(out, Buffer.from(r.payload, 'base64'));
    else writeFileSync(out, r.payload, 'utf8');
    console.log(chalk.green(`✓ Exported ${format.toUpperCase()} → ${out}`));
  } catch (e) {
    console.error(chalk.red('Failed: ' + e.message));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

function sanitize(name) {
  return String(name || 'export').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}
