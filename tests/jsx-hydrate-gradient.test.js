import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGradientFillString,
  hydrateJsxRemoteImages,
  parseJSX
} from '../src/core/operations.js';

test('isGradientFillString detects linear, radial, gradient(), and repeating forms', () => {
  assert.equal(isGradientFillString('linear-gradient(#a, #b)'), true);
  assert.equal(isGradientFillString('radial-gradient(#fff, #000)'), true);
  assert.equal(isGradientFillString('gradient(red, blue)'), true);
  assert.equal(isGradientFillString('repeating-linear-gradient(#a, #b 10%)'), true);
  assert.equal(isGradientFillString('#abc'), false);
});

test('hydrateJsxRemoteImages fetches https imageUrl into imageBase64', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), 'https://example.com/p.png');
    return {
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array([10, 20, 30]).buffer
    };
  });
  const trees = parseJSX('<Frame imageUrl="https://example.com/p.png" />');
  assert.equal(trees.length, 1);
  await hydrateJsxRemoteImages(trees);
  assert.ok(!('imageUrl' in trees[0].props));
  assert.equal(trees[0].props.imageBase64, Buffer.from([10, 20, 30]).toString('base64'));
});
