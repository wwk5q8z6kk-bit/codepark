import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessionFile, loadLatestSession, loadSession, loadSessionList, saveSession, writeSession } from '../src/session/store.js';

test('saveSession writes a transcript', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-session-'));
  const file = await saveSession({
    dir,
    messages: [{ role: 'user', content: 'hello' }]
  });
  assert.match(file, /\.json$/);
  const sessions = await loadSessionList(dir);
  assert.equal(sessions.length, 1);
});

test('writeSession updates a reusable session file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-session-'));
  const file = await createSessionFile({ dir, cwd: '/tmp/project' });

  await writeSession({
    file,
    cwd: '/tmp/project',
    messages: [{ role: 'user', content: 'hello' }]
  });

  const session = await loadSession({ dir, name: path.basename(file) });
  assert.equal(session.cwd, '/tmp/project');
  assert.equal(session.messages[0].content, 'hello');
});

test('loadLatestSession returns the newest session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-session-'));
  const older = path.join(dir, '2026-01-01T00-00-00.000Z.json');
  const newer = path.join(dir, '2026-01-02T00-00-00.000Z.json');
  await fs.writeFile(older, JSON.stringify({ messages: [{ role: 'user', content: 'old' }] }));
  await fs.writeFile(newer, JSON.stringify({ messages: [{ role: 'user', content: 'new' }] }));

  const session = await loadLatestSession(dir);

  assert.equal(path.basename(session.file), path.basename(newer));
  assert.equal(session.messages[0].content, 'new');
});
