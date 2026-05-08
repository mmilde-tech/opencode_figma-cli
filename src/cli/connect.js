import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, platform } from 'os';
import { isPatched, patchFigma, killFigma, startFigma, getCdpPort, getFigmaCommand } from '../core/figma-patch.js';
import { stopDaemon, isDaemonRunning } from '../core/daemon.js';
import { statusOf } from '../core/http.js';
import { probeDesignSession, isDesignEditorUrl, getCdpTargets } from '../core/figma-client.js';
import { resolveNodeExecutable } from '../core/node-exec.js';

const DAEMON_RUNNER = join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'daemon-runner.js');

/** Cold start: after spawning Figma, wait for a real editor tab (design/file URL). */
const COLD_START_GRACE_MS = 2500;
const COLD_START_POLL_MS = 1600;
const COLD_START_MAX_ATTEMPTS = 56; // grace + ~89s of polls

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function spawnDetachedDaemon() {
  // When the daemon fails to start on Windows, stdio='ignore' hides the reason.
  // Write stdout/stderr to ~/.opencode-figma/daemon.log so users can debug.
  const logFile = join(CONFIG_DIR, 'daemon.log');
  try { mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
  let out = 'ignore', err = 'ignore';
  try {
    const fd = openSync(logFile, 'a');
    out = fd;
    err = fd;
  } catch {}

  const child = spawn(resolveNodeExecutable(), [DAEMON_RUNNER], {
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true
  });
  child.unref();
  // Give Windows a bit more time to bind to 127.0.0.1:3456.
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await isDaemonRunning()) return true;
  }
  return false;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_DIR = join(homedir(), '.opencode-figma');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function readConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {}
  return {};
}

function writeConfig(config) {
  try { mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export default async function(options) {
  console.log(chalk.hex('#FF6B35')('\n  ✨ OpenCode-Figma ') + chalk.white("Control Figma from OpenCode!"));
  console.log(chalk.gray('  CDP (Yolo) — patch + remote debugging — No API key required\n'));

  return await yoloMode(options);
}

async function yoloMode(options) {
  console.log(chalk.hex('#FF6B35')('  🚀 Yolo Mode ') + chalk.gray('(direct CDP connection)\n'));

  const config = readConfig();

  // On Windows, we must re-check patch state every run because Figma updates
  // frequently and the app.asar path changes (Squirrel `app-<version>`).
  const shouldCheckPatch = platform() === 'win32' || !config.patched;
  if (shouldCheckPatch) {
    const patchSpinner = ora('Setting up Figma connection...').start();
    try {
      const patchStatus = isPatched();
      if (patchStatus === true) patchSpinner.succeed('Figma ready (already patched)');
      else if (patchStatus === false) {
        patchFigma();
        patchSpinner.succeed('Figma configured (patched)');
      } else {
        // On Windows, many Figma builds explicitly remove `remote-debugging-port`.
        // If we can't confidently detect the patch, attempt it and rely on a CDP probe after launch.
        if (platform() === 'win32') {
          try {
            patchFigma();
            patchSpinner.succeed('Figma configured (patched)');
          } catch (e) {
            patchSpinner.succeed('Figma ready (patch not applied)');
            console.log(chalk.yellow('  ⚠ ') + chalk.gray(String(e.message || e)));
            console.log(chalk.gray('  If CDP does not respond, retry as Administrator (Windows) or fix Full Disk Access (macOS).'));
          }
        } else {
          patchSpinner.succeed('Figma ready (no patch needed)');
        }
      }
      config.patched = true;
      writeConfig(config);
    } catch (err) {
      patchSpinner.fail('Setup failed: ' + err.message);
      printPermissionHelp();
      process.exit(1);
      return;
    }
  }

  // Fast path: CDP already answers with a design/file tab — no Figma restart.
  if (!options.forceRestart) {
    let port = config.cdpPort;
    let probe = port ? await probeDesignSession(port, { timeout: 1500 }) : { ok: false };

    if (!probe.ok) {
      const alt = await detectFigmaDebugPort();
      if (alt) {
        port = alt;
        config.cdpPort = alt;
        writeConfig(config);
        probe = await probeDesignSession(port, { timeout: 1500 });
      }
    }

    if (probe.ok && port) {
      config.cdpPort = port;
      writeConfig(config);
      await stopDaemon();
      const fast = ora('Reusing existing Figma session (CDP)...').start();
      fast.succeed(chalk.green(`Connected — CDP port ${port} (no restart)`));

      try {
        const ok = await spawnDetachedDaemon();
        if (!ok) console.log(chalk.yellow('  ⚠ Daemon did not respond to health check'));
      } catch (e) {
        console.log(chalk.yellow('  ⚠ Daemon failed to start: ' + e.message));
      }

      console.log(chalk.green('\n  ✓ Ready! OpenCode tools can talk to Figma.\n'));
      process.exit(0);
      return;
    }
  }

  await stopDaemon();

  let cdpPort = config.cdpPort;
  if (!cdpPort) {
    cdpPort = await detectFigmaDebugPort();
    if (!cdpPort) cdpPort = getCdpPort();
    config.cdpPort = cdpPort;
    writeConfig(config);
  }

  console.log(chalk.blue('Starting Figma with remote debugging...'));
  try {
    killFigma();
    await new Promise(r => setTimeout(r, 500));
  } catch {}
  try {
    startFigma(cdpPort);
  } catch (e) {
    console.error(chalk.red('Could not launch Figma: ' + e.message));
    process.exit(1);
    return;
  }
  console.log(chalk.green('✓ Figma launched'));
  console.log(
    chalk.gray(
      '  If you see the home or file browser: open any canvas — Recents → double‑click a file, or File → New design file.\n' +
        '  Connection completes once a design/file editor tab exists (not only the browser/home screen).\n'
    )
  );

  const spinner = ora('Waiting for Figma debug port and a canvas tab…').start();
  let connected = false;

  await sleep(COLD_START_GRACE_MS);

  // Fail fast if remote debugging never comes up (Windows builds often strip the flag).
  // If /json/version never responds, there's no point waiting for a canvas tab.
  const cdpsUp = await statusOf(`http://127.0.0.1:${cdpPort}/json/version`, { timeout: 600 }) === 200;
  if (!cdpsUp) {
    spinner.fail(`Figma launched, but CDP did not start on port ${cdpPort}.`);
    console.log(chalk.yellow('\n  This usually means Figma is stripping the ') + chalk.white('--remote-debugging-port') + chalk.yellow(' flag on Windows.'));
    console.log(chalk.white('  What to do next:\n'));
    console.log(chalk.cyan('  1. ') + chalk.white('Re-run your terminal as ') + chalk.yellow('Administrator') + chalk.white(' and run ') + chalk.cyan('opencode-figma connect') + chalk.white(' again.'));
    console.log(chalk.cyan('  2. ') + chalk.white('Confirm Figma was launched with ') + chalk.yellow('--remote-debugging-port') + chalk.white(' (this tool patches the app to enable it).'));
    console.log(chalk.gray(`\n  Figma launch command used:\n  ${getFigmaCommand(cdpPort)}\n`));
    process.exit(1);
    return;
  }

  // Plain stdout (not ora) so IDE/Agent Shell shows progress while “Thinking”
  console.log(
    chalk.gray(
      '[opencode-figma] CDP is up. Open a real design canvas (File → open, or Recents) — the home screen alone is not enough.'
    )
  );

  for (let i = 0; i < COLD_START_MAX_ATTEMPTS; i++) {
    const approxLeftSec = Math.max(
      0,
      Math.round((COLD_START_MAX_ATTEMPTS - i - 1) * (COLD_START_POLL_MS / 1000))
    );
    try {
      const pages = await getCdpTargets(cdpPort, { timeout: 4000 });
      if (pages.some((p) => isDesignEditorUrl(p.url))) {
        spinner.succeed('Canvas tab detected — CDP ready');
        connected = true;
        break;
      }
      const hasFigmaUi = pages.some(
        (p) => p.url && String(p.url).includes('figma.com')
      );
      if (hasFigmaUi) {
        spinner.text = `Figma is up — open a design file from Recents or create one (~${approxLeftSec}s)…`;
      } else {
        spinner.text = `Waiting for Figma on debug port ${cdpPort} (~${approxLeftSec}s)…`;
      }
    } catch {
      spinner.text = `Waiting for debug port ${cdpPort} (~${approxLeftSec}s)…`;
    }
    if (i > 0 && i % 6 === 0) {
      console.log(
        chalk.gray(
          `[opencode-figma] Still waiting for a canvas editor tab (~${approxLeftSec}s max left this step). ` +
            'In Figma: open any file so a document tab appears.'
        )
      );
    }
    await sleep(COLD_START_POLL_MS);
  }

  if (!connected) {
    spinner.fail('Still no canvas editor tab — connection timed out.');
    console.log(chalk.yellow('\n  What usually fixes this:\n'));
    console.log(chalk.white('  1. In Figma, open any file so a canvas tab appears (not just home/recents list).'));
    console.log(chalk.white('  2. Run ') + chalk.cyan('figma_connect') + chalk.white(' again (or ') + chalk.cyan('opencode-figma connect') + chalk.white(').\n'));
    console.log(chalk.gray(`  CDP port (saved): ${cdpPort}`));
    console.log(chalk.gray(`  Launch Figma manually with debugging:\n  ${getFigmaCommand(cdpPort)}\n`));
    process.exit(1);
    return;
  }

  try {
    const ok = await spawnDetachedDaemon();
    if (!ok) console.log(chalk.yellow('  ⚠ Daemon did not respond to health check'));
  } catch (e) {
    console.log(chalk.yellow('  ⚠ Daemon failed to start: ' + e.message));
  }

  console.log(chalk.green('\n  ✓ Ready! Connected to Figma.\n'));
  console.log(chalk.white('  Talk to OpenCode:\n'));
  console.log(chalk.white('    "Add shadcn colors to my project"'));
  console.log(chalk.white('    "Create a blue card with rounded corners"'));
  console.log(chalk.white('    "Show me what\'s on the canvas"\n'));

  process.exit(0);
}

async function detectFigmaDebugPort() {
  const candidates = [
    9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230,
    9231, 9232, 9240, 9250, 9260, 9270, 9280, 9290, 9300, 9322
  ];
  for (const port of candidates) {
    if (await statusOf(`http://localhost:${port}/json/version`, { timeout: 250 }) !== 200) continue;
    try {
      const pages = await getCdpTargets(port, { timeout: 1000 });
      if (pages.some(p => isDesignEditorUrl(p.url))) return port;
    } catch {}
  }
  return null;
}

function printPermissionHelp() {
  const p = platform();
  if (p === 'darwin') {
    console.log(chalk.hex('#FF6B35')('\n  ┌─────────────────────────────────────────────────────┐'));
    console.log(chalk.hex('#FF6B35')('  │') + chalk.white.bold('  One-time setup required (macOS)                   ') + chalk.hex('#FF6B35')('│'));
    console.log(chalk.hex('#FF6B35')('  └─────────────────────────────────────────────────────┘\n'));

    console.log(chalk.white('  Your Terminal needs permission to configure Figma.\n'));
    console.log(chalk.cyan('  Step 1: ') + chalk.white('Open ') + chalk.yellow('System Settings'));
    console.log(chalk.cyan('  Step 2: ') + chalk.white('Go to ') + chalk.yellow('Privacy & Security → Full Disk Access'));
    console.log(chalk.cyan('  Step 3: ') + chalk.white('Click ') + chalk.yellow('+') + chalk.white(' and add ') + chalk.yellow('Terminal'));
    console.log(chalk.cyan('  Step 4: ') + chalk.white('Quit Terminal completely ') + chalk.gray('(Cmd+Q)'));
    console.log(chalk.cyan('  Step 5: ') + chalk.white('Reopen Terminal and try again\n'));
  } else if (p === 'win32') {
    console.log(chalk.hex('#FF6B35')('\n  ┌─────────────────────────────────────────────────────┐'));
    console.log(chalk.hex('#FF6B35')('  │') + chalk.white.bold('  One-time setup required (Windows)                 ') + chalk.hex('#FF6B35')('│'));
    console.log(chalk.hex('#FF6B35')('  └─────────────────────────────────────────────────────┘\n'));

    console.log(chalk.white('  Patching Figma needs write access to its app.asar file.\n'));
    console.log(chalk.cyan('  Option A: ') + chalk.white('Run your terminal as ') + chalk.yellow('Administrator') + chalk.white(' once'));
    console.log(chalk.white('             then re-run: ') + chalk.cyan('opencode-figma connect'));
  } else {
    console.log(chalk.white('\n  Patching Figma failed. You may need to run with elevated permissions.'));
  }
}
