import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSecret } from '../src/secrets.js';

test('maskSecret does not expose complete value', () => {
  assert.equal(maskSecret('sk-1234567890'), 'sk-1...7890');
  assert.equal(maskSecret('short'), '[set]');
  assert.equal(maskSecret(''), '');
});
