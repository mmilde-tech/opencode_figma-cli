import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'path';
import { resolveNodeExecutable } from '../src/core/node-exec.js';

test('resolveNodeExecutable returns the node binary when execPath is node', () => {
  const r = resolveNodeExecutable();
  assert.ok(r.length > 0);
  const b = basename(r).toLowerCase();
  assert.ok(b === 'node' || b === 'node.exe', `expected node, got ${r}`);
});
