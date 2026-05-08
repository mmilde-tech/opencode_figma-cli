import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { startDaemon, stopDaemon, isDaemonRunning } from '../core/daemon.js';
import { resolveNodeExecutable } from '../core/node-exec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_RUNNER = join(__dirname, '..', 'core', 'daemon-runner.js');
const DAEMON_PID_FILE = join(homedir(), '.opencode-figma-daemon.pid');

export default async function daemonCommand(action, options) {
  const a = String(action || '').toLowerCase();

  if (a === 'start') {
    if (await isDaemonRunning()) { console.log(chalk.yellow('Daemon already running')); return; }
    const spinner = ora('Starting daemon...').start();
    try {
      // Spawn detached child running the daemon runner. Parent exits, child lives on.
      const child = spawn(resolveNodeExecutable(), [DAEMON_RUNNER], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();

      // Wait up to 5s for the daemon to listen.
      let up = false;
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (await isDaemonRunning()) { up = true; break; }
      }
      if (up) spinner.succeed(`Daemon started (pid ${child.pid})`);
      else spinner.fail('Daemon did not respond on health check after 5s');
    } catch (e) {
      spinner.fail('Failed: ' + e.message);
      process.exitCode = 1;
    }
    return;
  }

  if (a === 'stop') {
    const spinner = ora('Stopping daemon...').start();
    try {
      await stopDaemon();
      spinner.succeed('Daemon stopped');
    } catch (e) {
      spinner.fail('Failed: ' + e.message);
      process.exitCode = 1;
    }
    return;
  }

  if (a === 'restart') {
    await stopDaemon();
    await new Promise((r) => setTimeout(r, 500));
    return daemonCommand('start', options);
  }

  if (a === 'status') {
    const running = await isDaemonRunning();
    if (running) {
      let pid = null;
      try { pid = readFileSync(DAEMON_PID_FILE, 'utf8').trim(); } catch {}
      console.log(chalk.green(`✓ Daemon running${pid ? ` (pid ${pid})` : ''}`));
    } else {
      console.log(chalk.yellow('✗ Daemon not running'));
    }
    return;
  }

  console.log(chalk.red('Unknown action: ' + action));
  process.exitCode = 1;
}
