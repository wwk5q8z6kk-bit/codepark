import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubprocessEnv, isSecretEnvName } from '../src/env.js';

test('createSubprocessEnv strips obvious secret environment variables', () => {
  const env = createSubprocessEnv({
    PATH: '/bin',
    HOME: '/tmp/home',
    CODEPARK_API_KEY: 'sk-test',
    OPENAI_API_KEY: 'sk-openai',
    CUSTOM_TOKEN: 'token',
    NORMAL_VALUE: 'ok'
  });

  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/tmp/home');
  assert.equal(env.NORMAL_VALUE, 'ok');
  assert.equal(env.CODEPARK_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CUSTOM_TOKEN, undefined);
});

test('isSecretEnvName detects common credential names', () => {
  assert.equal(isSecretEnvName('OPENAI_API_KEY'), true);
  assert.equal(isSecretEnvName('GITHUB_TOKEN'), true);
  assert.equal(isSecretEnvName('DB_PASSWORD'), true);
  assert.equal(isSecretEnvName('PATH'), false);
});
