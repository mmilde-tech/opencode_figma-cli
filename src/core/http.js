// Cross-platform HTTP helpers (no curl dependency).
// Used by figma-client.js / daemon.js / connect.js so the plugin works
// identically on macOS, Windows, and Linux.

import http from 'http';

export function httpGet(url, { timeout = 2000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy(new Error('Request timeout (' + timeout + 'ms)'));
    });
  });
}

export async function getJSON(url, opts) {
  const { status, body } = await httpGet(url, opts);
  if (status < 200 || status >= 300) {
    throw new Error('HTTP ' + status + ' ' + url);
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error('Invalid JSON from ' + url + ': ' + e.message);
  }
}

export async function statusOf(url, opts = {}) {
  try {
    const { status } = await httpGet(url, { ...opts, timeout: opts.timeout ?? 1000 });
    return status;
  } catch {
    return 0;
  }
}
