import { WebSocket } from 'ws';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { RUNTIME } from './figma-runtime.js';
import { getJSON } from './http.js';
import {
  dbgTargets,
  dbgConnect,
  dbgCdp,
  dbgRetry,
  safeCdpParams
} from './cdp-logger.js';

function getSavedCdpPort() {
  try {
    const configFile = join(homedir(), '.opencode-figma', 'config.json');
    if (existsSync(configFile)) {
      const config = JSON.parse(readFileSync(configFile, 'utf8'));
      if (config.cdpPort) return config.cdpPort;
    }
  } catch {}
  return null;
}

/** Saved CDP port from ~/.opencode-figma/config.json (for messaging). */
export function getConfiguredCdpPort() {
  return getSavedCdpPort();
}

/**
 * True if URL is a design or file *editor* tab. Uses path segments so
 * https://www.figma.com/files/... (feed, recents) does not match.
 */
const DESIGN_PATH_RE = /figma\.com\/(design|file)\//;
export function isDesignEditorUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return DESIGN_PATH_RE.test(url);
}

/**
 * List CDP targets (tabs). Tries /json first; if empty (sandboxed Figma / Electron),
 * falls back to browser Target.getTargets — same strategy as robust Figma CDP clients.
 */
export async function getCdpTargets(port, { timeout = 5000 } = {}) {
  const base = `http://127.0.0.1:${port}`;
  const jsonTimeout = Math.min(2000, timeout);

  let pages;
  try {
    pages = await getJSON(`${base}/json`, { timeout: jsonTimeout });
  } catch {
    pages = [];
  }
  if (!Array.isArray(pages)) pages = [];
  if (pages.length > 0) {
    dbgTargets('GET /json → %d page target(s)', pages.length);
    return pages;
  }

  dbgTargets('GET /json empty, trying Target.getTargets via browser websocket');

  let version;
  try {
    version = await getJSON(`${base}/json/version`, { timeout: jsonTimeout });
  } catch {
    return [];
  }
  const browserWsUrl = version?.webSocketDebuggerUrl;
  if (!browserWsUrl) return [];

  return new Promise((resolve) => {
    const wsBrowse = new WebSocket(browserWsUrl);
    const finish = (targets) => {
      clearTimeout(to);
      try {
        wsBrowse.close();
      } catch {}
      resolve(targets);
    };
    const to = setTimeout(() => finish([]), timeout);
    wsBrowse.on('open', () => {
      wsBrowse.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
    });
    wsBrowse.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === 1 && msg.result) {
          const host = '127.0.0.1';
          const targets = (msg.result.targetInfos || [])
            .filter((t) => t.type === 'page')
            .map((t) => ({
              id: t.targetId,
              title: t.title,
              url: t.url,
              webSocketDebuggerUrl: `ws://${host}:${port}/devtools/page/${t.targetId}`
            }));
          dbgTargets('Target.getTargets → %d page target(s)', targets.length);
          finish(targets);
        }
      } catch {
        finish([]);
      }
    });
    wsBrowse.on('error', () => finish([]));
  });
}

/**
 * Probe localhost CDP for an active Figma design/file session.
 * Used by connect (fast path) and FigmaClient.isConnected().
 */
export async function probeDesignSession(port, { timeout = 2000 } = {}) {
  try {
    const pages = await getCdpTargets(port, { timeout });
    const hasDesign = pages.some((p) => isDesignEditorUrl(p.url));
    dbgTargets(
      'probe port=%s designTab=%s (of %d targets)',
      port,
      hasDesign,
      pages.length
    );
    return { ok: hasDesign, pages };
  } catch {
    dbgTargets('probe port=%s failed', port);
    return { ok: false, pages: null };
  }
}

let ws = null;
let pendingMessages = new Map();
let messageIdCounter = 0;

/** Shared CDP session (one socket per process). Cleared on close or failed connect. */
let connectionMeta = { port: null, pageId: null, pageTitle: null, executionContextId: null };

/** Serialize connect(); module-level ws/pendingMaps must not overlap two handshakes. */
let connectInFlight = null;

function syncClientFromSharedSession(client) {
  client.port = connectionMeta.port;
  client.pageId = connectionMeta.pageId;
  client.pageTitle = connectionMeta.pageTitle;
  client.executionContextId = connectionMeta.executionContextId;
}

function clearConnectionMeta() {
  connectionMeta = { port: null, pageId: null, pageTitle: null, executionContextId: null };
}

function rejectAllPending(reason) {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  dbgConnect('rejectAllPending (%d): %s', pendingMessages.size, err.message);
  for (const [, pending] of pendingMessages) {
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(err);
  }
  pendingMessages.clear();
}

// Used to validate whether user code is a single expression or a statement block.
const AsyncFunction = (async function () {}).constructor;
function isExpressionBody(code) {
  try {
    // eslint-disable-next-line no-new
    new AsyncFunction(`return (${code});`);
    return true;
  } catch {
    return false;
  }
}

export class FigmaClient {
  constructor() {
    this.port = null;
    this.pageId = null;
    this.pageTitle = null;
    /** @type {number|null} CDP execution context holding figma (Figma v39+); null = default */
    this.executionContextId = null;
    // Windows can be substantially slower at large node graphs; 30s was too aggressive
    // and caused mid-operation aborts for component-set builds.
    this.commandTimeoutMs = 180000;
  }

  static async isConnected() {
    const port = getSavedCdpPort();
    if (!port) return false;
    const { ok } = await probeDesignSession(port);
    return ok;
  }

  async connect() {
    if (ws && ws.readyState === 1) {
      syncClientFromSharedSession(this);
      return;
    }

    if (!connectInFlight) {
      connectInFlight = this._establishConnection().finally(() => {
        connectInFlight = null;
      });
    }

    await connectInFlight;

    if (!(ws && ws.readyState === 1)) {
      throw new Error('Not connected');
    }
    syncClientFromSharedSession(this);
  }

  /** Opens WebSocket + resolves Figma execution context; assumes caller serialized via connect(). */
  async _establishConnection() {
    if (ws && ws.readyState === 1) return;

    this.port = getSavedCdpPort();
    if (!this.port) throw new Error('No saved CDP port found. Run "opencode-figma connect" first.');

    const pages = await getCdpTargets(this.port, { timeout: 5000 });
    const figmaPage = pages.find((p) => isDesignEditorUrl(p.url));
    if (!figmaPage) throw new Error('No Figma file open.');

    dbgConnect(
      'attach page id=%s title=%s url=%s…',
      figmaPage.id,
      figmaPage.title,
      String(figmaPage.url || '').slice(0, 72)
    );

    this.pageId = figmaPage.id;
    this.pageTitle = figmaPage.title;
    this.executionContextId = null;

    const wsUrl = figmaPage.webSocketDebuggerUrl;

    await new Promise((resolve, reject) => {
      const executionContexts = [];
      const newWs = new WebSocket(wsUrl);
      ws = newWs;
      pendingMessages = new Map();
      messageIdCounter = 0;

      const connectionTimeout = setTimeout(() => {
        dbgConnect('connection timeout (15s) closing websocket');
        rejectAllPending(new Error('Connection timeout'));
        if (ws === newWs) ws = null;
        clearConnectionMeta();
        try {
          newWs.close();
        } catch {}
        reject(new Error('Connection timeout'));
      }, 15000);

      const fail = (err) => {
        dbgConnect('connect failed: %s', err.message || String(err));
        clearTimeout(connectionTimeout);
        rejectAllPending(err);
        if (ws === newWs) ws = null;
        this.executionContextId = null;
        clearConnectionMeta();
        try {
          newWs.close();
        } catch {}
        reject(err);
      };

      newWs.on('message', (data) => {
        let response;
        try {
          response = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (response.method === 'Runtime.executionContextCreated') {
          const c = response.params?.context;
          executionContexts.push(c);
          dbgConnect(
            'Runtime.executionContextCreated id=%s name=%s',
            c?.id,
            c?.name || ''
          );
          return;
        }
        if (response.id != null && pendingMessages.has(response.id)) {
          const pending = pendingMessages.get(response.id);
          pendingMessages.delete(response.id);
          if (pending.timer) clearTimeout(pending.timer);
          if (response.error) {
            dbgCdp(
              '← id=%s method=%s ERROR %o',
              response.id,
              pending.method || '?',
              response.error
            );
            pending.reject(new Error(response.error.message));
          } else {
            dbgCdp('← id=%s method=%s ok', response.id, pending.method || '?');
            pending.resolve(response.result);
          }
        }
      });

      newWs.on('open', async () => {
        dbgConnect('websocket open → Runtime.enable');
        try {
          await this.sendCommand('Runtime.enable');

          const probeFigma = async (contextId) => {
            const params = { expression: 'typeof figma !== "undefined"', returnByValue: true };
            if (contextId != null) params.contextId = contextId;
            const payload = await this.sendCommand('Runtime.evaluate', params);
            if (payload?.exceptionDetails) return false;
            return payload?.result?.value === true;
          };

          const resolveExecutionContext = async () => {
            if (await probeFigma(undefined)) {
              this.executionContextId = null;
              return true;
            }
            for (const ctx of executionContexts) {
              try {
                if (await probeFigma(ctx.id)) {
                  this.executionContextId = ctx.id;
                  return true;
                }
              } catch {
                /* context may be gone */
              }
            }
            return false;
          };

          for (let attempt = 0; attempt < 12; attempt++) {
            await new Promise((r) => setTimeout(r, attempt === 0 ? 400 : 200));
            if (await resolveExecutionContext()) {
              clearTimeout(connectionTimeout);
              dbgConnect(
                'Figma execution context ready executionContextId=%s',
                this.executionContextId ?? 'default'
              );
              connectionMeta = {
                port: this.port,
                pageId: this.pageId,
                pageTitle: this.pageTitle,
                executionContextId: this.executionContextId
              };
              resolve();
              return;
            }
          }
          fail(new Error('Could not find Figma plugin context. Open a design file tab.'));
        } catch (e) {
          fail(e);
        }
      });

      newWs.on('error', (err) => fail(new Error('WebSocket failed: ' + err.message)));
      newWs.on('close', () => {
        dbgConnect('websocket close');
        if (ws === newWs) ws = null;
      });
    });
  }

  async sendCommand(method, params = {}) {
    if (!ws || ws.readyState !== 1) throw new Error('Not connected');

    // CDP requires integer ids; floats are echoed back as undefined.
    const id = ++messageIdCounter;
    const message = JSON.stringify({ id, method, params });

    dbgCdp('→ id=%s method=%s %o', id, method, safeCdpParams(method, params));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingMessages.has(id)) {
          pendingMessages.delete(id);
          dbgCdp('timeout id=%s method=%s (%dms)', id, method, this.commandTimeoutMs || 180000);
          reject(new Error('Command timeout'));
        }
      }, this.commandTimeoutMs || 180000);
      pendingMessages.set(id, { resolve, reject, timer, method });
      ws.send(message);
    });
  }

  /**
   * Stability-first wrapper: retry once on transient CDP failures by reconnecting.
   * This avoids "random" failures when Figma reloads / context switches.
   */
  async _sendWithRetry(method, params) {
    try {
      return await this.sendCommand(method, params);
    } catch (e) {
      const msg = e?.message || String(e);
      const transient =
        msg.includes('Not connected') ||
        msg.includes('WebSocket failed') ||
        msg.includes('Command timeout') ||
        msg.includes('Connection timeout');
      if (!transient) throw e;

      dbgRetry('transient CDP error (%s), reconnect + retry Runtime.evaluate once', msg);

      // Drop shared session and retry once.
      try { this.close(); } catch {}
      await this.connect();
      return await this.sendCommand(method, params);
    }
  }

  async eval(code, context = undefined) {
    // Pass `context` as a JSON-serialized blob into the evaluated scope so
    // commands can avoid string-interpolating untrusted user input.
    const ctxJson = context === undefined ? 'undefined' : JSON.stringify(context);
    const inner = isExpressionBody(code)
      ? `(async () => { return (${code}); })()`
      : `(async () => {\n${code}\n})()`;
    const wrappedCode = `(async (ctx) => {
      try {
        const result = await ${inner};
        return { success: true, result: JSON.stringify(result === undefined ? null : result) };
      } catch (e) {
        return { success: false, error: e.message, stack: e.stack };
      }
    })(${ctxJson})`;

    const evalParams = {
      expression: wrappedCode,
      awaitPromise: true,
      returnByValue: true
    };
    if (this.executionContextId != null) evalParams.contextId = this.executionContextId;

    const envelope = await this._sendWithRetry('Runtime.evaluate', evalParams);

    if (envelope?.exceptionDetails) {
      const ex = envelope.exceptionDetails;
      const msg = ex.exception?.description || ex.text || 'Eval failed';
      throw new Error(msg);
    }

    const remoteObject = envelope?.result;
    if (!remoteObject) return undefined;

    if (remoteObject.subtype === 'error') {
      throw new Error(remoteObject.description || 'Eval failed');
    }

    const value = remoteObject.value;
    if (value === undefined || value === null) return value;

    if (value.success === false) throw new Error(value.error || 'Eval failed');
    return value.result !== undefined ? JSON.parse(value.result) : undefined;
  }

  // Convenience: run code with the in-Figma runtime (`_oc`) preloaded.
  async run(body, ctx = undefined) {
    const code = isExpressionBody(body)
      ? `${RUNTIME}\nreturn (${body});`
      : `${RUNTIME}\n${body}`;
    return await this.eval(code, ctx);
  }

  async getPageInfo() {
    return await this.eval(`({
      name: figma.currentPage.name,
      children: figma.currentPage.children.length
    })`);
  }

  close() {
    this.executionContextId = null;
    closeSharedFigmaTransport();
  }
}

/** Close module-level CDP socket without a FigmaClient instance (e.g. after failed handshake). */
export function closeSharedFigmaTransport() {
  dbgConnect('closeSharedFigmaTransport');
  try {
    rejectAllPending(new Error('Connection closed'));
  } catch {}
  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }
  clearConnectionMeta();
}
