import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStyleReference,
  resolveStyleId,
  resolveStyleList,
  listCanonicalStyleIds
} from '../src/creative/load-style-pack.js';

test('resolveStyleId accepts canonical id and aliases', () => {
  assert.equal(resolveStyleId('Swiss'), 'swiss');
  assert.equal(resolveStyleId('international style'), 'swiss');
  assert.equal(resolveStyleId('retro'), 'retro-60s-70s');
  assert.equal(resolveStyleId('synthwave'), 'vaporwave');
  assert.equal(resolveStyleId('grunge'), 'grunge-punk');
  assert.equal(resolveStyleId('frosted-glass'), 'glassmorphism');
  assert.equal(resolveStyleId('glass-ui'), 'glassmorphism');
  assert.equal(resolveStyleId('editorial'), 'editorial-magazine');
  assert.equal(resolveStyleId('kuznetsov'), 'gleb-kuznetsov');
  assert.equal(resolveStyleId('brass-age'), 'steampunk');
  assert.equal(resolveStyleId('neumorphism'), 'neumorphism-soft-ui');
  assert.equal(resolveStyleId('soft-ui'), 'neumorphism-soft-ui');
  assert.equal(resolveStyleId('not-a-real-style'), null);
});

test('resolveStyleList dedupes and preserves order', () => {
  const { ids, unknown } = resolveStyleList(['swiss', 'Swiss', 'bauhaus']);
  assert.deepEqual(ids, ['swiss', 'bauhaus']);
  assert.deepEqual(unknown, []);
});

test('buildStyleReference loads neumorphism-soft-ui from manifest', () => {
  const text = buildStyleReference({
    task: 'general',
    styles: ['neumorphism-soft-ui'],
    includeCheckpointQuestions: false
  });
  assert.match(text, /Neumorphism|soft UI|neumorphism-soft-ui/i);
});

test('buildStyleReference rejects unknown styles', () => {
  assert.throws(
    () => buildStyleReference({ task: 'general', styles: ['nope'] }),
    /Unknown style/
  );
});

test('buildStyleReference rejects too many styles', () => {
  const many = ['swiss', 'bauhaus', 'memphis', 'brutalism', 'cyberpunk', 'modern-flat'];
  assert.throws(
    () => buildStyleReference({ task: 'general', styles: many }),
    /at most 5/
  );
});

test('buildStyleReference task-only (no styles) includes task anatomy', () => {
  const text = buildStyleReference({
    task: 'poster',
    styles: [],
    includeCheckpointQuestions: false
  });
  assert.match(text, /Creative task: poster/i);
  assert.match(text, /one-sheet/i);
  assert.match(text, /figma_render typography/i);
  assert.match(text, /16px/);
});

test('buildStyleReference branding + style includes shared typography block', () => {
  const text = buildStyleReference({
    task: 'branding',
    styles: ['luxury-premium'],
    includeCheckpointQuestions: false
  });
  assert.match(text, /figma_render typography/i);
  assert.match(text, /130%/);
  assert.match(text, /Verify/i);
  assert.match(text, /CTA frames|Primary button/i);
  assert.match(text, /banner frames/i);
});

test('buildStyleReference includes manifest about when present', () => {
  const text = buildStyleReference({
    task: 'general',
    styles: [],
    includeCheckpointQuestions: false
  });
  assert.match(text, /creative style packs guide typography/i);
});

test('buildStyleReference merges task + style + respects maxChars', () => {
  const full = buildStyleReference({
    task: 'branding',
    styles: ['art-deco'],
    includeCheckpointQuestions: false,
    maxChars: 50000
  });
  assert.match(full, /Art Deco/i);
  assert.match(full, /branding board/i);

  const short = buildStyleReference({
    task: 'general',
    styles: ['swiss'],
    includeCheckpointQuestions: false,
    maxChars: 200
  });
  assert.match(short, /truncated/i);
  assert.ok(short.length >= 200 && short.length < 400);
});

test('compact mode does not expand output vs non-compact', () => {
  const normal = buildStyleReference({
    task: 'general',
    styles: ['swiss', 'bauhaus', 'memphis'],
    includeCheckpointQuestions: false,
    maxChars: 50000
  });
  const small = buildStyleReference({
    task: 'general',
    styles: ['swiss', 'bauhaus', 'memphis'],
    compact: true,
    includeCheckpointQuestions: false,
    maxChars: 50000
  });
  assert.ok(small.length <= normal.length);
});

test('listCanonicalStyleIds includes manifest entries', () => {
  const ids = listCanonicalStyleIds();
  assert.ok(ids.includes('swiss'));
  assert.ok(ids.includes('retro-60s-70s'));
  assert.ok(ids.includes('glassmorphism'));
  assert.ok(ids.includes('neumorphism-soft-ui'));
});
