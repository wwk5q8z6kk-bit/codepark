import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCommandPolicy } from '../src/security/commandPolicy.js';

test('allows harmless read-only commands without extra risk', () => {
  assert.equal(evaluateCommandPolicy('git status'), 'allowedWithPermission');
});

test('blocks destructive root removal', () => {
  assert.equal(evaluateCommandPolicy('rm -rf /'), 'disabled');
});

test('requires permission for variable expansion', () => {
  assert.equal(evaluateCommandPolicy('cat $HOME/.ssh/config'), 'allowedWithPermission');
});

test('blocks dangerous command in a pipeline', () => {
  assert.equal(evaluateCommandPolicy('echo hi | sh'), 'disabled');
});
