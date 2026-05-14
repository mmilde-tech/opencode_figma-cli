import test from 'node:test';
import assert from 'node:assert/strict';
import { stripImageBase64Payload } from '../src/core/operations.js';

test('stripImageBase64Payload accepts raw base64 and data URLs', () => {
  assert.equal(stripImageBase64Payload(' ab cd \n'), 'abcd');
  assert.equal(
    stripImageBase64Payload('data:image/png;base64,QQ=='),
    'QQ=='
  );
});
