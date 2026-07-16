import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  sendShellSessionCommand,
  startShellSession,
  stopShellSession
} from '../src/shellSession.js';

test('shell sessions preserve environment across commands', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-shell-'));
  const session = startShellSession(root, { id: 'env-test' });
  try {
    await sendShellSessionCommand(session.id, 'FOO=codepark');
    const result = await sendShellSessionCommand(session.id, 'echo $FOO');
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /codepark/);
  } finally {
    stopShellSession(session.id);
  }
});

test('shell sessions preserve cwd across commands', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-shell-'));
  await fs.mkdir(path.join(root, 'subdir'));
  const session = startShellSession(root, { id: 'cwd-test' });
  try {
    await sendShellSessionCommand(session.id, 'cd subdir');
    const result = await sendShellSessionCommand(session.id, 'pwd');
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /subdir/);
  } finally {
    stopShellSession(session.id);
  }
});

test('stopping a shell session terminates a running child process', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-shell-'));
  const pidFile = path.join(root, 'child.pid');
  const session = startShellSession(root, { id: 'stop-child-test' });
  let childPid = 0;

  try {
    await assert.rejects(
      () => sendShellSessionCommand(
        session.id,
        `node -e "setInterval(() => {}, 1000)" & echo $! > ${shellQuote(pidFile)}; wait`,
        { timeoutMs: 100 }
      ),
      /timed out/
    );

    childPid = Number((await fs.readFile(pidFile, 'utf8')).trim());
    assert.ok(processExists(childPid), `expected child process ${childPid} to be running`);

    stopShellSession(session.id);
    await waitForProcessExit(childPid);
  } finally {
    if (childPid && processExists(childPid)) {
      process.kill(childPid, 'SIGKILL');
    }
  }
});

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`process ${pid} was still running after shell session stop`);
}
