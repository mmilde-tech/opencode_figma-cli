/**
 * Opt-in CDP / WebSocket tracing via the `debug` package.
 *
 *   set DEBUG=opencode-figma:*          (PowerShell: $env:DEBUG='opencode-figma:*')
 *   DEBUG=opencode-figma:cdp            — outbound commands + inbound errors
 *   DEBUG=opencode-figma:connect        — handshake, execution context, ws lifecycle
 *   DEBUG=opencode-figma:targets        — CDP target discovery (/json, Target.getTargets)
 *   DEBUG=opencode-figma:retry          — transient failures + reconnect retries
 *   DEBUG=opencode-figma:cdp:verbose    — first ~400 chars of Runtime.evaluate expressions
 *
 * Never logs full eval bodies or full CDP results by default (can be huge).
 */
import createDebug from 'debug';

export const dbgTargets = createDebug('opencode-figma:targets');
export const dbgConnect = createDebug('opencode-figma:connect');
export const dbgCdp = createDebug('opencode-figma:cdp');
export const dbgCdpVerbose = createDebug('opencode-figma:cdp:verbose');
export const dbgRetry = createDebug('opencode-figma:retry');

const PREVIEW = 400;

/**
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 */
export function safeCdpParams(method, params) {
  if (!params || typeof params !== 'object') return params;

  if (method === 'Runtime.evaluate') {
    const ex = params.expression;
    const len = typeof ex === 'string' ? ex.length : 0;
    const out = {
      contextId: params.contextId,
      awaitPromise: params.awaitPromise,
      returnByValue: params.returnByValue,
      expression: typeof ex === 'string' ? `<string ${len} chars>` : typeof ex
    };
    if (dbgCdpVerbose.enabled && typeof ex === 'string' && len > 0) {
      out.expressionPreview = ex.length > PREVIEW ? ex.slice(0, PREVIEW) + '…' : ex;
    }
    return out;
  }

  try {
    const s = JSON.stringify(params);
    if (s.length <= 900) return params;
    return { _truncated: true, byteLength: s.length, preview: s.slice(0, 900) + '…' };
  } catch {
    return '[params not JSON-serializable]';
  }
}
