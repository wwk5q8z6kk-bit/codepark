import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseLines } from '../src/streaming.js';

test('parseSseLines extracts data payloads', () => {
  const chunks = parseSseLines('data: {"x":1}\n\ndata: [DONE]\n\n');
  assert.deepEqual(chunks, ['{"x":1}', '[DONE]']);
});
