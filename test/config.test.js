import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getConfigPath, loadConfig, maskConfig, modelAuthStatus, saveConfig } from '../src/config.js';

test('maskConfig masks api keys', () => {
  const result = maskConfig({
    baseUrl: 'https://example.test/v1',
    model: 'model',
    apiKey: 'sk-1234567890',
    timeoutMs: 1000
  }, '/tmp/work');
  assert.equal(result.apiKey, 'sk-1...7890');
});

test('saveConfig writes private config file permissions', async () => {
  const previousDir = process.env.CODEPARK_CONFIG_DIR;
  const previousCodeParkKey = process.env.CODEPARK_API_KEY;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-config-'));
  process.env.CODEPARK_CONFIG_DIR = dir;
  delete process.env.CODEPARK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await saveConfig({ provider: 'openai', apiKey: 'sk-test-secret' });
    const stat = await fs.stat(getConfigPath());
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(loadConfig().apiKey, 'sk-test-secret');
  } finally {
    if (previousDir === undefined) delete process.env.CODEPARK_CONFIG_DIR;
    else process.env.CODEPARK_CONFIG_DIR = previousDir;
    if (previousCodeParkKey === undefined) delete process.env.CODEPARK_API_KEY;
    else process.env.CODEPARK_API_KEY = previousCodeParkKey;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
});

test('saveConfig can store api keys outside the config file', async () => {
  const previousDir = process.env.CODEPARK_CONFIG_DIR;
  const previousStore = process.env.CODEPARK_SECRET_STORE;
  const previousMockDir = process.env.CODEPARK_KEYCHAIN_MOCK_DIR;
  const previousCodeParkKey = process.env.CODEPARK_API_KEY;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-config-'));
  const mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-keychain-'));
  process.env.CODEPARK_CONFIG_DIR = dir;
  process.env.CODEPARK_SECRET_STORE = 'keychain';
  process.env.CODEPARK_KEYCHAIN_MOCK_DIR = mockDir;
  delete process.env.CODEPARK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await saveConfig({ provider: 'openai', apiKey: 'sk-keychain-secret' });
    const fileConfig = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
    assert.equal(fileConfig.secretStore, 'keychain');
    assert.equal(fileConfig.apiKey, undefined);
    assert.equal(loadConfig().apiKey, 'sk-keychain-secret');
  } finally {
    if (previousDir === undefined) delete process.env.CODEPARK_CONFIG_DIR;
    else process.env.CODEPARK_CONFIG_DIR = previousDir;
    if (previousStore === undefined) delete process.env.CODEPARK_SECRET_STORE;
    else process.env.CODEPARK_SECRET_STORE = previousStore;
    if (previousMockDir === undefined) delete process.env.CODEPARK_KEYCHAIN_MOCK_DIR;
    else process.env.CODEPARK_KEYCHAIN_MOCK_DIR = previousMockDir;
    if (previousCodeParkKey === undefined) delete process.env.CODEPARK_API_KEY;
    else process.env.CODEPARK_API_KEY = previousCodeParkKey;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
});

test('modelAuthStatus allows local providers without an api key', () => {
  const result = modelAuthStatus({
    baseUrl: 'http://localhost:11434/v1',
    apiKey: ''
  });
  assert.equal(result.ok, true);
});

test('modelAuthStatus allows codex base URLs without an api key', () => {
  const result = modelAuthStatus({
    baseUrl: 'codex://local-session',
    apiKey: ''
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /codex CLI/);
});

test('secure mode implies local-only codex defaults', async () => {
  const previousDir = process.env.CODEPARK_CONFIG_DIR;
  const previousPath = process.env.CODEPARK_CONFIG_PATH;
  const previousProvider = process.env.CODEPARK_PROVIDER;
  const previousBaseUrl = process.env.CODEPARK_BASE_URL;
  const previousLocalOnly = process.env.CODEPARK_LOCAL_ONLY;
  const previousSecureMode = process.env.CODEPARK_SECURE_MODE;
  process.env.CODEPARK_CONFIG_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-config-'));
  process.env.CODEPARK_CONFIG_PATH = '';
  delete process.env.CODEPARK_PROVIDER;
  delete process.env.CODEPARK_BASE_URL;
  delete process.env.CODEPARK_LOCAL_ONLY;
  delete process.env.CODEPARK_SECURE_MODE;
  try {
    const config = loadConfig({
      secureMode: true,
      apiKey: ''
    });

    assert.equal(config.secureMode, true);
    assert.equal(config.localOnly, true);
    assert.equal(config.provider, 'codex');
    assert.equal(config.baseUrl, 'codex://cli');
  } finally {
    if (previousDir === undefined) delete process.env.CODEPARK_CONFIG_DIR;
    else process.env.CODEPARK_CONFIG_DIR = previousDir;
    if (previousPath === undefined) delete process.env.CODEPARK_CONFIG_PATH;
    else process.env.CODEPARK_CONFIG_PATH = previousPath;
    if (previousProvider === undefined) delete process.env.CODEPARK_PROVIDER;
    else process.env.CODEPARK_PROVIDER = previousProvider;
    if (previousBaseUrl === undefined) delete process.env.CODEPARK_BASE_URL;
    else process.env.CODEPARK_BASE_URL = previousBaseUrl;
    if (previousLocalOnly === undefined) delete process.env.CODEPARK_LOCAL_ONLY;
    else process.env.CODEPARK_LOCAL_ONLY = previousLocalOnly;
    if (previousSecureMode === undefined) delete process.env.CODEPARK_SECURE_MODE;
    else process.env.CODEPARK_SECURE_MODE = previousSecureMode;
  }
});

test('modelAuthStatus requires api key for remote providers', () => {
  const result = modelAuthStatus({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: ''
  });
  assert.equal(result.ok, false);
  assert.match(result.guidance, /setup/);
});
