import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveProviderProfile } from './providers/profiles.js';
import { normalizeSecretStore, readStoredSecretSync, saveStoredSecret } from './secrets.js';

const configDir = path.join(os.homedir(), '.codepark');
const configPath = path.join(configDir, 'config.json');

export function loadConfig(overrides = {}) {
  const fileConfig = readConfigFile();
  const secureMode = positiveBoolean(
    overrides.secureMode
      ?? process.env.CODEPARK_SECURE_MODE
      ?? fileConfig.secureMode,
    false
  );
  const localOnly = secureMode || positiveBoolean(
    overrides.localOnly
      ?? process.env.CODEPARK_LOCAL_ONLY
      ?? fileConfig.localOnly,
    false
  );
  let providerName = overrides.provider
    ?? process.env.CODEPARK_PROVIDER
    ?? fileConfig.provider
    ?? '';
  if (localOnly && !providerName) providerName = 'codex';
  const provider = providerName ? resolveProviderProfile(providerName) : null;
  const secretStore = normalizeSecretStore(
    overrides.secretStore
      ?? process.env.CODEPARK_SECRET_STORE
      ?? fileConfig.secretStore
  );
  const secretAccount = overrides.secretAccount
    ?? process.env.CODEPARK_SECRET_ACCOUNT
    ?? fileConfig.secretAccount
    ?? 'default';
  const contextLimitTokens = positiveNumber(
    overrides.contextLimitTokens
      ?? process.env.CODEPARK_CONTEXT_LIMIT_TOKENS
      ?? fileConfig.contextLimitTokens,
    120000
  );
  const compactThresholdTokens = positiveNumber(
    overrides.compactThresholdTokens
      ?? process.env.CODEPARK_COMPACT_THRESHOLD_TOKENS
      ?? fileConfig.compactThresholdTokens,
    Math.floor(contextLimitTokens * 0.8)
  );
  return {
    secureMode,
    localOnly,
    provider: provider?.name ?? '',
    baseUrl: overrides.baseUrl
      ?? process.env.CODEPARK_BASE_URL
      ?? fileConfig.baseUrl
      ?? provider?.baseUrl
      ?? 'https://api.openai.com/v1',
    model: overrides.model
      ?? process.env.CODEPARK_MODEL
      ?? process.env.OPENAI_MODEL
      ?? fileConfig.model
      ?? provider?.defaultModel
      ?? 'gpt-4o-mini',
    apiKey: overrides.apiKey
      ?? process.env.CODEPARK_API_KEY
      ?? (provider ? process.env[provider.apiKeyEnv] : undefined)
      ?? process.env.OPENAI_API_KEY
      ?? (secretStore === 'keychain'
        ? readStoredSecretSync({ store: secretStore, account: secretAccount })
        : fileConfig.apiKey)
      ?? '',
    secretStore,
    secretAccount,
    timeoutMs: positiveNumber(process.env.CODEPARK_TIMEOUT_MS ?? fileConfig.timeoutMs, 120000),
    contextLimitTokens,
    compactThresholdTokens
  };
}

export async function saveConfig(partial) {
  await fsp.mkdir(getConfigDir(), { recursive: true, mode: 0o700 });
  await fsp.chmod(getConfigDir(), 0o700);
  const current = readConfigFile();
  const secretStore = normalizeSecretStore(
    partial.secretStore
      ?? process.env.CODEPARK_SECRET_STORE
      ?? current.secretStore
  );
  const secretAccount = partial.secretAccount
    ?? process.env.CODEPARK_SECRET_ACCOUNT
    ?? current.secretAccount
    ?? 'default';
  const next = { ...current, ...partial, secretStore, secretAccount };
  if (secretStore === 'keychain' && Object.hasOwn(partial, 'apiKey')) {
    if (partial.apiKey) {
      await saveStoredSecret({ store: secretStore, account: secretAccount, secret: partial.apiKey });
    }
    delete next.apiKey;
  }
  await fsp.writeFile(getConfigPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fsp.chmod(getConfigPath(), 0o600);
}

export function maskConfig(config, cwd) {
  return {
    secureMode: Boolean(config.secureMode),
    localOnly: Boolean(config.localOnly),
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey ? `${config.apiKey.slice(0, 4)}...${config.apiKey.slice(-4)}` : '',
    secretStore: config.secretStore,
    timeoutMs: config.timeoutMs,
    contextLimitTokens: config.contextLimitTokens,
    compactThresholdTokens: config.compactThresholdTokens,
    cwd
  };
}

export function isLocalBaseUrl(value) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(value ?? '');
}

export function isCodexBaseUrl(value) {
  return /^codex:\/\//.test(value ?? '');
}

export function isLocalOnlyBaseUrl(value) {
  return isCodexBaseUrl(value) || isLocalBaseUrl(value);
}

export function modelAuthStatus(config) {
  if (config.apiKey) {
    return { ok: true, message: 'api key set' };
  }
  if (providerDoesNotRequireApiKey(config.provider)) {
    return { ok: true, message: `${config.provider} provider does not require an API key` };
  }
  if (isCodexBaseUrl(config.baseUrl)) {
    return { ok: true, message: 'codex CLI base URL; API key optional' };
  }
  if (isLocalBaseUrl(config.baseUrl)) {
    return { ok: true, message: 'local base URL; API key optional' };
  }
  return {
    ok: false,
    message: 'api key missing',
    guidance: 'Use /setup or /key in interactive mode, or run codepark setup.'
  };
}

function providerDoesNotRequireApiKey(name) {
  if (!name) return false;
  try {
    return resolveProviderProfile(name).requiresApiKey === false;
  } catch {
    return false;
  }
}

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  } catch {
    return {};
  }
}

export function getConfigDir() {
  return process.env.CODEPARK_CONFIG_DIR ?? configDir;
}

export function getConfigPath() {
  return process.env.CODEPARK_CONFIG_PATH ?? path.join(getConfigDir(), path.basename(configPath));
}

export function configFileExists() {
  try {
    return fs.existsSync(getConfigPath());
  } catch {
    return false;
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function positiveBoolean(value, fallback) {
  if (value === true) return true;
  if (value === false) return false;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (text === '1' || text === 'true' || text === 'yes' || text === 'y') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'n') return false;
  return fallback;
}
