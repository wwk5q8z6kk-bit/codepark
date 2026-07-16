import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRunFirstRunOnboarding } from '../src/onboarding.js';

test('shouldRunFirstRunOnboarding starts only for a fresh interactive terminal', () => {
  assert.equal(shouldRunFirstRunOnboarding({
    flags: {},
    env: {},
    inputIsTty: true,
    configExists: false
  }), true);

  assert.equal(shouldRunFirstRunOnboarding({
    flags: {},
    env: {},
    inputIsTty: false,
    configExists: false
  }), false);

  assert.equal(shouldRunFirstRunOnboarding({
    flags: {},
    env: {},
    inputIsTty: true,
    configExists: true
  }), false);

  assert.equal(shouldRunFirstRunOnboarding({
    flags: { provider: 'codex' },
    env: {},
    inputIsTty: true,
    configExists: false
  }), false);

  assert.equal(shouldRunFirstRunOnboarding({
    flags: {},
    env: { CODEPARK_PROVIDER: 'codex' },
    inputIsTty: true,
    configExists: false
  }), false);
});
