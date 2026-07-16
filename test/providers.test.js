import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderProfile } from '../src/providers/profiles.js';

test('resolves openai profile', () => {
  const profile = resolveProviderProfile('openai');
  assert.equal(profile.baseUrl, 'https://api.openai.com/v1');
  assert.ok(profile.defaultModel);
});

test('resolves ollama profile', () => {
  const profile = resolveProviderProfile('ollama');
  assert.equal(profile.baseUrl, 'http://localhost:11434/v1');
  assert.equal(profile.requiresApiKey, false);
});

test('rejects unknown provider', () => {
  assert.throws(
    () => resolveProviderProfile('missing'),
    error => error?.code === 'EARGS' && /unknown provider/.test(error.message)
  );
});
