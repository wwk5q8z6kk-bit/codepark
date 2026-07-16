import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShellWords, quoteShellWords } from '../src/shellSyntax.js';

test('parseShellWords keeps quoted arguments and shell operators distinct', () => {
  assert.deepEqual(parseShellWords('node -e "console.log(1)" && echo done'), [
    'node',
    '-e',
    'console.log(1)',
    { op: '&&' },
    'echo',
    'done'
  ]);
});

test('quoteShellWords preserves embedded single quotes for shell execution', () => {
  assert.equal(
    quoteShellWords(['node', '-e', "console.log('done')"]),
    "node -e 'console.log('\"'\"'done'\"'\"')'"
  );
});
