// Entry point for the detached daemon process.
// Executed by `opencode-figma daemon start` via a detached spawn.

import { startDaemon } from './daemon.js';

const port = Number(process.env.OPENCODE_FIGMA_DAEMON_PORT || 3456);

startDaemon(port, 'auto').catch((err) => {
  process.stderr.write('daemon failed: ' + (err?.message || err) + '\n');
  process.exit(1);
});
