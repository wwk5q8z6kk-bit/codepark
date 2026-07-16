import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const keychainService = 'CodePark API Key';

export async function promptHidden({ input, output, prompt }) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('secure input requires an interactive terminal');
  }

  output.write(prompt);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = '';

    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(wasRaw);
      output.write('\n');
    };

    const onData = chunk => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('secret input cancelled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    input.on('data', onData);
  });
}

export function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '[set]';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function normalizeSecretStore(value) {
  const store = String(value ?? '').trim().toLowerCase();
  if (!store || store === 'file') return 'file';
  if (store === 'keychain') return 'keychain';
  throw new Error('secret store must be file or keychain');
}

export function readStoredSecretSync({ store, account }) {
  if (normalizeSecretStore(store) !== 'keychain') return '';
  const mockDir = process.env.CODEPARK_KEYCHAIN_MOCK_DIR;
  if (mockDir) {
    try {
      return fs.readFileSync(mockSecretPath(mockDir, account), 'utf8');
    } catch {
      return '';
    }
  }
  if (process.platform !== 'darwin') return '';
  try {
    return execFileSync('security', [
      'find-generic-password',
      '-a',
      normalizeAccount(account),
      '-s',
      keychainService,
      '-w'
    ], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export async function saveStoredSecret({ store, account, secret }) {
  if (normalizeSecretStore(store) !== 'keychain') return;
  if (process.env.CODEPARK_KEYCHAIN_MOCK_DIR) {
    const file = mockSecretPath(process.env.CODEPARK_KEYCHAIN_MOCK_DIR, account);
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fsp.writeFile(file, secret, { mode: 0o600 });
    await fsp.chmod(file, 0o600);
    return;
  }
  if (process.platform !== 'darwin') {
    throw new Error('keychain secret store is only available on macOS');
  }
  await execFileAsync('security', [
    'add-generic-password',
    '-a',
    normalizeAccount(account),
    '-s',
    keychainService,
    '-w',
    secret,
    '-U'
  ]);
}

function mockSecretPath(directory, account) {
  return path.join(directory, `${normalizeAccount(account).replace(/[^A-Za-z0-9_.-]+/g, '_')}.secret`);
}

function normalizeAccount(account) {
  return String(account ?? 'default').trim() || 'default';
}
