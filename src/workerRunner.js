#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeJsonAtomic } from './atomicWrite.js';
import { createSubprocessEnv } from './env.js';

const [statusPath, logPath, cwd, command, maxRuntimeMsValue, messagePath] = process.argv.slice(2);
let child = null;
let stopping = false;
let messagePoll = null;
let maxRuntimeTimer = null;
let messageOffset = 0;
let messageRemainder = '';
let deliveringMessages = false;

if (!statusPath || !logPath || !cwd || !command) {
  process.stderr.write('workerRunner requires statusPath, logPath, cwd, and command\n');
  process.exit(2);
}

await fs.mkdir(path.dirname(logPath), { recursive: true });
const log = createWriteStream(logPath, { flags: 'a' });
await appendLog(`$ ${command}\n`);
await updateStatus({ status: 'running', pid: process.pid, updatedAt: new Date().toISOString() });

if (messagePath) {
  await fs.mkdir(path.dirname(messagePath), { recursive: true });
  await fs.writeFile(messagePath, '', { flag: 'a' });
}

child = spawn(command, {
  cwd,
  shell: process.platform === 'win32' ? true : (process.env.SHELL || '/bin/sh'),
  env: createSubprocessEnv(process.env),
  windowsHide: true,
  stdio: [messagePath ? 'pipe' : 'ignore', 'pipe', 'pipe']
});

await updateStatus({
  status: 'running',
  pid: process.pid,
  commandPid: child.pid,
  updatedAt: new Date().toISOString()
});

if (messagePath) startMessagePump();
startMaxRuntimeTimer();

child.stdout.on('data', chunk => {
  log.write(chunk);
});
child.stderr.on('data', chunk => {
  log.write(chunk);
});
child.stdin?.on('error', error => {
  void appendLog(`[worker stdin unavailable: ${error.message}]\n`);
});
child.on('error', async error => {
  await appendLog(`${error.message}\n`);
  await finish('failed', null);
});
child.on('exit', async code => {
  if (stopping) return;
  await finish(code === 0 ? 'done' : 'failed', code);
});

process.on('SIGTERM', async () => {
  stopping = true;
  if (child && !child.killed) child.kill('SIGTERM');
  await appendLog('\n[worker stopped]\n');
  await finish('stopped', null);
});

process.on('SIGINT', async () => {
  stopping = true;
  if (child && !child.killed) child.kill('SIGINT');
  await appendLog('\n[worker stopped]\n');
  await finish('stopped', null);
});

function finish(status, exitCode) {
  if (messagePoll) clearInterval(messagePoll);
  if (maxRuntimeTimer) clearTimeout(maxRuntimeTimer);
  return updateStatus({
    status,
    exitCode,
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  }).finally(() => {
    log.end(() => process.exit(status === 'done' ? 0 : 1));
  });
}

function startMaxRuntimeTimer() {
  const maxRuntimeMs = Number(maxRuntimeMsValue);
  if (!Number.isFinite(maxRuntimeMs) || maxRuntimeMs <= 0) return;
  maxRuntimeTimer = setTimeout(() => {
    void expireWorker(maxRuntimeMs);
  }, maxRuntimeMs);
  maxRuntimeTimer.unref?.();
}

async function expireWorker(maxRuntimeMs) {
  if (stopping) return;
  stopping = true;
  await appendLog(`\n[worker max runtime exceeded: ${maxRuntimeMs}ms]\n`);
  if (child && !child.killed) {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child && !child.killed) child.kill('SIGKILL');
    }, 500).unref?.();
  }
  await updateStatus({ failureReason: `max runtime exceeded: ${maxRuntimeMs}ms` });
  await finish('failed', null);
}

async function updateStatus(patch) {
  const current = await fs.readFile(statusPath, 'utf8')
    .then(text => JSON.parse(text))
    .catch(() => ({}));
  await writeJsonAtomic(statusPath, { ...current, ...patch });
}

function appendLog(value) {
  return new Promise(resolve => {
    log.write(value, resolve);
  });
}

function startMessagePump() {
  messagePoll = setInterval(() => {
    void deliverMessages();
  }, 100);
  void deliverMessages();
}

async function deliverMessages() {
  if (deliveringMessages || !messagePath || !child?.stdin?.writable) return;
  deliveringMessages = true;
  try {
    const file = await fs.open(messagePath, 'r').catch(error => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!file) return;
    try {
      const stat = await file.stat();
      if (stat.size <= messageOffset) return;
      const length = stat.size - messageOffset;
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, messageOffset);
      messageOffset = stat.size;
      messageRemainder += buffer.toString('utf8');
      const lines = messageRemainder.split(/\r?\n/);
      messageRemainder = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const record = parseMessageRecord(line);
        child.stdin.write(`\n[CodePark follow-up @ ${record.createdAt}]\n${record.message}\n`);
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    await appendLog(`[worker message delivery failed: ${error.message}]\n`);
  } finally {
    deliveringMessages = false;
  }
}

function parseMessageRecord(line) {
  try {
    const record = JSON.parse(line);
    return {
      createdAt: String(record.createdAt ?? new Date().toISOString()),
      message: String(record.message ?? '')
    };
  } catch {
    return {
      createdAt: new Date().toISOString(),
      message: line
    };
  }
}
