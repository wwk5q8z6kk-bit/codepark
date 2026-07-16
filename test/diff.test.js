import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnifiedDiff } from '../src/diff.js';

test('createUnifiedDiff includes removed and added lines', () => {
  const output = createUnifiedDiff('a.txt', 'one\n', 'two\n');
  assert.match(output, /-one/);
  assert.match(output, /\+two/);
});

test('createUnifiedDiff preserves unchanged middle lines across separate edits', () => {
  const before = [
    'alpha',
    'old first',
    'middle stays',
    'old second',
    'omega',
    ''
  ].join('\n');
  const after = [
    'alpha',
    'new first',
    'middle stays',
    'new second',
    'omega',
    ''
  ].join('\n');

  const output = createUnifiedDiff('a.txt', before, after);

  assert.match(output, /^ middle stays$/m);
  assert.doesNotMatch(output, /^-middle stays$/m);
  assert.doesNotMatch(output, /^\+middle stays$/m);
});
