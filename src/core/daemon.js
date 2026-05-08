import { createServer } from 'http';
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { FigmaClient } from './figma-client.js';
import { httpGet } from './http.js';

const DAEMON_PORT = 3456;
const STOP_GRACEFUL_MS = 2000;
const STOP_FORCE_WAIT_MS = 3000;
const STOP_POLL_MS = 150;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Best-effort graceful stop (Windows: taskkill without /F; POSIX: SIGTERM). */
function signalGracefulStop(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (platform() === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T'], { windowsHide: true, encoding: 'utf8' });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
}

/** Force terminate process tree (Windows: taskkill /F; POSIX: SIGKILL). */
function signalForceStop(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (platform() === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

const IDLE_TIMEOUT_MS = parseInt(process.env.OPENCODE_FIGMA_DAEMON_IDLE_MS || '', 10) || 10 * 60 * 1000;
const CONFIG_DIR = join(homedir(), '.opencode-figma');
const DAEMON_PID_FILE = join(homedir(), '.opencode-figma-daemon.pid');
const DAEMON_TOKEN_FILE = join(CONFIG_DIR, '.daemon-token');

let daemonToken = null;
let mode = 'auto';
let idleTimer = null;

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    try { mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
  }
}

function generateToken() {
  ensureConfigDir();
  daemonToken = randomBytes(32).toString('hex');
  try { writeFileSync(DAEMON_TOKEN_FILE, daemonToken, { mode: 0o600 }); } catch {}
  return daemonToken;
}

function getToken({ fresh = false } = {}) {
  if (!fresh && daemonToken) return daemonToken;
  try {
    daemonToken = readFileSync(DAEMON_TOKEN_FILE, 'utf8').trim();
    return daemonToken;
  } catch { return null; }
}

function validateToken(req) {
  const token = getToken();
  if (!token) return true;
  return req.headers['x-daemon-token'] === token;
}

/** Mitigate DNS rebinding against localhost HTTP servers. */
function validateHost(req, res) {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid host' }));
    return false;
  }
  return true;
}

function bumpIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('[opencode-figma daemon] idle timeout — exiting');
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
}

export async function startDaemon(port = DAEMON_PORT, daemonMode = 'auto') {
  mode = daemonMode;
  generateToken();

  const server = createServer(async (req, res) => {
    if (!validateHost(req, res)) return;
    bumpIdleTimer();

    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Daemon-Token');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!validateToken(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (req.url === '/health' && req.method === 'GET') {
      const health = { status: 'ok', mode };
      try { health.cdp = await FigmaClient.isConnected(); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }

    if (req.url === '/exec' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        const jsonErr = (msg, status = 400) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: msg }));
        };
        try {
          const trimmed = body.trim();
          if (!trimmed) {
            jsonErr('Empty body');
            return;
          }
          let data;
          try {
            data = JSON.parse(trimmed);
          } catch (e) {
            jsonErr(e instanceof SyntaxError ? 'Invalid JSON body' : 'Invalid JSON body: ' + e.message);
            return;
          }
          const action = data.action;
          let result;
          if (action === 'eval') result = await execEval(data.code);
          else if (action === 'run') result = await execRun(data.body, data.context);
          else throw new Error('Unknown action: ' + action);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      try { writeFileSync(DAEMON_PID_FILE, String(process.pid)); } catch {}
      bumpIdleTimer();
      if (process.send) process.send('ready');
      resolve(server);
    });
  });
}

async function execEval(code) {
  const client = new FigmaClient();
  await client.connect();
  try { return await client.eval(code); } finally { client.close(); }
}

async function execRun(body, context) {
  const client = new FigmaClient();
  await client.connect();
  try { return await client.run(body, context); } finally { client.close(); }
}

/**
 * Stop the speed daemon: SIGTERM / soft taskkill, poll /health until down, then SIGKILL /F if needed.
 * Removes the PID file when done.
 */
export async function stopDaemon(port = DAEMON_PORT) {
  let pid = NaN;
  try {
    if (existsSync(DAEMON_PID_FILE)) {
      pid = parseInt(readFileSync(DAEMON_PID_FILE, 'utf8').trim(), 10);
    }
  } catch {
    return;
  }

  if (!Number.isFinite(pid)) {
    try { unlinkSync(DAEMON_PID_FILE); } catch {}
    return;
  }

  signalGracefulStop(pid);

  const gracefulUntil = Date.now() + STOP_GRACEFUL_MS;
  while (Date.now() < gracefulUntil) {
    if (!(await isDaemonRunning(port))) {
      try { unlinkSync(DAEMON_PID_FILE); } catch {}
      return;
    }
    await sleep(STOP_POLL_MS);
  }

  signalForceStop(pid);

  const forceUntil = Date.now() + STOP_FORCE_WAIT_MS;
  while (Date.now() < forceUntil) {
    if (!(await isDaemonRunning(port))) break;
    await sleep(STOP_POLL_MS);
  }

  try { unlinkSync(DAEMON_PID_FILE); } catch {}
}

export async function isDaemonRunning(port = DAEMON_PORT) {
  try {
    // Always re-read so we don't use a stale cached token after the daemon
    // restarts and rotates its token file.
    const token = getToken({ fresh: true });
    const headers = token ? { 'X-Daemon-Token': token } : {};
    const { status } = await httpGet(`http://127.0.0.1:${port}/health`, { timeout: 2500, headers });
    return status === 200;
  } catch {
    return false;
  }
}
