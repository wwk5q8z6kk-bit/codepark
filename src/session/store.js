import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic } from '../atomicWrite.js';

export const defaultSessionDir = process.env.CODEPARK_SESSION_DIR ?? path.join(os.homedir(), '.codepark', 'sessions');

export async function saveSession({ dir = defaultSessionDir, cwd = process.cwd(), messages }) {
  const file = await createSessionFile({ dir, cwd });
  await writeSession({ file, cwd, messages });
  return file;
}

export async function createSessionFile({ dir = defaultSessionDir, cwd = process.cwd() } = {}) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => {});
  const file = path.join(dir, `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}.json`);
  await writeSession({ file, cwd, messages: [] });
  return file;
}

export async function writeSession({ file, cwd, messages }) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const body = {
    version: 1,
    updatedAt: new Date().toISOString(),
    cwd,
    messages
  };
  await writeJsonAtomic(file, body, { mode: 0o600 });
  return file;
}

export async function loadSessionList(dir = defaultSessionDir) {
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.filter(name => name.endsWith('.json')).sort();
}

export async function loadSession({ dir = defaultSessionDir, name }) {
  if (!name) return loadLatestSession(dir);
  const file = path.join(dir, path.basename(name));
  const body = JSON.parse(await fs.readFile(file, 'utf8'));
  return normalizeSession(file, body);
}

export async function loadLatestSession(dir = defaultSessionDir) {
  const sessions = await loadSessionList(dir);
  if (!sessions.length) throw new Error(`No sessions in ${dir}`);
  return loadSession({ dir, name: sessions.at(-1) });
}

function normalizeSession(file, body) {
  return {
    file,
    cwd: typeof body.cwd === 'string' ? body.cwd : '',
    messages: Array.isArray(body.messages) ? body.messages : []
  };
}
