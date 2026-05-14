import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const opsPath = join(dir, '..', 'src', 'core', 'operations.js');

test('RENDERER embed includes typography defaults and JSX props for Text', () => {
  const src = fs.readFileSync(opsPath, 'utf8');
  const startMark = 'const RENDERER = `';
  const i = src.indexOf(startMark);
  assert.ok(i >= 0, 'RENDERER not found');
  const start = i + startMark.length;
  const end = src.indexOf('`;', start);
  assert.ok(end > start, 'RENDERER closing not found');
  const body = src.slice(start, end);
  assert.match(body, /else node\.fontSize = 16/);
  assert.match(body, /else if \(t === 'label'\) node\.fontSize = 14/);
  assert.match(body, /else if \(t === 'h3'\) node\.fontSize = 20/);
  assert.match(body, /textAlignHorizontal/);
  assert.match(body, /props\.lineHeight/);
  assert.match(body, /props\.letterSpacing/);
  assert.match(body, /unit: 'PERCENT', value: 130/);
  assert.match(body, /isButtonLikeFrame/);
  assert.match(body, /isSectionLikeFrame/);
});
