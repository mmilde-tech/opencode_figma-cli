import { basename } from 'path';

/**
 * Executable to use when spawning Node entry scripts (`opencode-figma`, daemon-runner, etc.).
 *
 * In a normal terminal, `process.execPath` is the real `node` binary. In OpenCode's
 * plugin host (and similar Electron/embedders), `process.execPath` may be the host
 * app (e.g. `opencode`). Spawning that binary with our CLI path runs the host’s CLI
 * instead — typically printing OpenCode’s help and never executing opencode-figma.
 */
export function resolveNodeExecutable() {
  const fromEnv = process.env.OPENCODE_FIGMA_NODE || process.env.NODE_BINARY;
  if (fromEnv) return fromEnv;

  for (const p of [process.execPath, process.argv[0]]) {
    if (!p) continue;
    const b = basename(p).toLowerCase();
    if (b === 'node' || b === 'node.exe') return p;
  }

  return 'node';
}
