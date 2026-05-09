import chalk from 'chalk';
import { readFileSync } from 'fs';
import { validateCreateSetVariants } from '../core/validate.js';

function readStdinOrFile(pathOrDash) {
  const p = pathOrDash === undefined || pathOrDash === '' ? '-' : pathOrDash;
  if (p === '-') return readFileSync(0, 'utf8');
  return readFileSync(p, 'utf8');
}

/** CLI entry: validate jsx-create-set --file variants.json */
export default async function validateCommand(type, options) {
  const t = String(type || '').toLowerCase().trim();
  try {
    if (t === 'jsx-create-set' || t === 'jsx' || t === 'create-set-jsx') {
      const raw = options.file ? readStdinOrFile(options.file) : readStdinOrFile('-');
      const variants = JSON.parse(raw);
      const r = validateCreateSetVariants(variants);
      if (r.ok) {
        console.log(chalk.green(`✓ JSX create-set OK (${variants.length} variant(s))`));
        return;
      }
      console.error(chalk.red(`${r.issues.length} issue(s):`));
      for (const it of r.issues) console.error(chalk.red(`  [${it.kind}] ${it.message}`));
      process.exitCode = 1;
      return;
    }
    throw new Error(`Unknown validate type "${type}". Use: jsx-create-set`);
  } catch (e) {
    console.error(chalk.red('validate failed: ' + e.message));
    process.exitCode = 1;
  }
}
