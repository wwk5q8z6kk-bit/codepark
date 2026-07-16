import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addTask } from '../src/tasks.js';
import {
  formatWorkerList,
  formatWorkerPruned,
  formatWorkerRead,
  listWorkers,
  pruneWorkers,
  readWorker,
  sendAgentMessage,
  startAgentWorker,
  startWorker,
  stopWorker
} from '../src/workers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('background workers run commands scoped to tasks and persist logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Run background work', now: '2026-04-18T12:00:00.000Z' });
  const command = `${JSON.stringify(process.execPath)} -e "console.log('worker done')"`;

  const worker = await startWorker(root, { taskId: task.id, command, id: 'worker-test' });
  assert.equal(worker.taskId, task.id);
  assert.equal(worker.status, 'running');

  const finished = await waitForWorker(root, 'worker-test', worker => worker.status !== 'running');
  assert.equal(finished.status, 'done');
  assert.equal(finished.exitCode, 0);

  const read = await readWorker(root, 'worker-test');
  assert.match(read.output, /worker done/);
  assert.match(formatWorkerRead(read), /worker done/);
  assert.match(formatWorkerList(await listWorkers(root)), /worker-test/);
});

test('background workers can be stopped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Stop background work', now: '2026-04-18T12:00:00.000Z' });
  const command = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`;

  await startWorker(root, { taskId: task.id, command, id: 'worker-stop' });
  const stopped = await stopWorker(root, 'worker-stop');

  assert.equal(stopped.status, 'stopped');
  const listed = await listWorkers(root);
  assert.equal(listed[0].status, 'stopped');
});

test('background worker stop cleans up stubborn child processes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Stop stubborn worker', now: '2026-04-18T12:00:00.000Z' });
  const command = `${JSON.stringify(process.execPath)} -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"`;

  await startWorker(root, { taskId: task.id, command, id: 'worker-stubborn' });
  const running = await waitForWorker(root, 'worker-stubborn', worker => worker.status === 'running');
  const status = JSON.parse(await fs.readFile(path.join(root, running.statusPath), 'utf8'));

  await stopWorker(root, 'worker-stubborn');

  assert.equal(isPidAlive(running.pid), false);
  assert.equal(isPidAlive(status.commandPid), false);
});

test('background workers fail when max runtime is exceeded', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Expire background work', now: '2026-04-18T12:00:00.000Z' });
  const command = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`;

  await startWorker(root, { taskId: task.id, command, id: 'worker-expire', maxRuntimeMs: 100 });
  const expired = await waitForWorker(root, 'worker-expire', worker => worker.status === 'failed');
  const read = await readWorker(root, 'worker-expire');

  assert.equal(expired.failureReason, 'max runtime exceeded: 100ms');
  assert.match(read.output, /worker max runtime exceeded: 100ms/);
});

test('background workers can prune completed records and logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const doneTask = await addTask(root, { title: 'Done worker', now: '2026-04-18T12:00:00.000Z' });
  const runningTask = await addTask(root, { title: 'Running worker', now: '2026-04-18T12:01:00.000Z' });
  const doneCommand = `${JSON.stringify(process.execPath)} -e "console.log('done worker')"`;
  const runningCommand = `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`;

  const done = await startWorker(root, { taskId: doneTask.id, command: doneCommand, id: 'worker-done' });
  const running = await startWorker(root, { taskId: runningTask.id, command: runningCommand, id: 'worker-running' });
  await waitForWorker(root, 'worker-done', worker => worker.status !== 'running');

  const pruned = await pruneWorkers(root);

  assert.equal(pruned.removed.length, 1);
  assert.equal(pruned.kept.length, 1);
  assert.equal(pruned.removed[0].id, 'worker-done');
  assert.match(formatWorkerPruned(pruned), /removed: 1/);
  await assert.rejects(() => fs.stat(path.join(root, done.logPath)), /ENOENT/);
  await fs.stat(path.join(root, running.logPath));
  assert.deepEqual((await listWorkers(root)).map(worker => worker.id), ['worker-running']);

  await stopWorker(root, running.id);
});

test('background workers can prune only failed records and logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  await writeWorkerRecords(root, [
    { id: 'worker-failed', status: 'failed', exitCode: 1 },
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);

  const pruned = await pruneWorkers(root, { failedOnly: true });

  assert.deepEqual(pruned.removed.map(worker => worker.id), ['worker-failed']);
  assert.deepEqual(pruned.kept.map(worker => worker.id), ['worker-done']);
  await assert.rejects(() => fs.stat(path.join(root, '.codepark', 'workers', 'worker-failed.log')), /ENOENT/);
  await fs.stat(path.join(root, '.codepark', 'workers', 'worker-done.log'));
  assert.deepEqual((await listWorkers(root)).map(worker => worker.id), ['worker-done']);
});

test('listWorkers marks dead running processes as failed and persists the recovery status', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  await fs.mkdir(path.join(root, '.codepark', 'workers'), { recursive: true });
  const worker = {
    id: 'worker-stale',
    taskId: 'task-stale',
    taskTitle: 'Recover stale worker',
    kind: 'shell',
    command: 'node stale.js',
    cwd: root,
    status: 'running',
    pid: 99999999,
    exitCode: null,
    logPath: '.codepark/workers/worker-stale.log',
    statusPath: '.codepark/workers/worker-stale.status.json',
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-18T12:00:00.000Z'
  };
  await fs.writeFile(path.join(root, '.codepark', 'workers.json'), `${JSON.stringify({ version: 1, workers: [worker] }, null, 2)}\n`);
  await fs.writeFile(path.join(root, worker.statusPath), `${JSON.stringify(worker, null, 2)}\n`);
  await fs.writeFile(path.join(root, worker.logPath), 'stale output\n');

  const [recovered] = await listWorkers(root);
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.failureReason, 'process not found');
  assert.ok(recovered.finishedAt);
  assert.match(formatWorkerList([recovered]), /reason: process not found/);

  const persisted = JSON.parse(await fs.readFile(path.join(root, worker.statusPath), 'utf8'));
  assert.equal(persisted.status, 'failed');
  assert.equal(persisted.failureReason, 'process not found');
});

test('listWorkers gives recently updated dead workers time to persist final status', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  await fs.mkdir(path.join(root, '.codepark', 'workers'), { recursive: true });
  const worker = {
    id: 'worker-recent',
    taskId: 'task-recent',
    taskTitle: 'Recently exited worker',
    kind: 'shell',
    command: 'node recent.js',
    cwd: root,
    status: 'running',
    pid: 99999999,
    exitCode: null,
    logPath: '.codepark/workers/worker-recent.log',
    statusPath: '.codepark/workers/worker-recent.status.json',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(root, '.codepark', 'workers.json'), `${JSON.stringify({ version: 1, workers: [worker] }, null, 2)}\n`);
  await fs.writeFile(path.join(root, worker.statusPath), `${JSON.stringify(worker, null, 2)}\n`);
  await fs.writeFile(path.join(root, worker.logPath), 'recent output\n');

  const [listed] = await listWorkers(root);

  assert.equal(listed.status, 'running');
  assert.equal(listed.failureReason, undefined);
  const persisted = JSON.parse(await fs.readFile(path.join(root, worker.statusPath), 'utf8'));
  assert.equal(persisted.status, 'running');
});

test('background agent workers run codex exec scoped to tasks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Delegate agent work', now: '2026-04-18T12:00:00.000Z' });
  const mockCodex = await writeMockCodex(root);

  const worker = await startAgentWorker(root, {
    taskId: task.id,
    prompt: 'Inspect the project and report risks.',
    id: 'agent-test',
    codexCommand: [process.execPath, mockCodex]
  });

  assert.equal(worker.kind, 'agent');
  assert.equal(worker.taskId, task.id);
  assert.equal(worker.agentDriver, 'codex-session');
  assert.match(worker.command, /agentSessionRunner/);

  const running = await waitForWorker(root, 'agent-test', worker => worker.status === 'running');
  assert.equal(running.status, 'running');
  await waitForWorkerOutput(root, 'agent-test', /mock codex invoked/);
  const read = await readWorker(root, 'agent-test');
  assert.match(read.output, /mock codex invoked/);
  assert.match(read.output, /Inspect the project and report risks/);
  assert.match(read.output, new RegExp(task.id));
  await stopWorker(root, 'agent-test');
});

test('background agent stop terminates the session runner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Stop agent worker', now: '2026-04-18T12:00:00.000Z' });
  const mockCodex = await writeMockCodex(root, [
    '#!/usr/bin/env node',
    "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'stop-thread' }))",
    "console.log('stop agent initial turn')"
  ]);

  await startAgentWorker(root, {
    taskId: task.id,
    prompt: 'Start and stop.',
    id: 'agent-stop',
    codexCommand: [process.execPath, mockCodex]
  });

  const running = await waitForWorker(root, 'agent-stop', worker => worker.status === 'running');
  await waitForWorkerOutput(root, 'agent-stop', /stop agent initial turn/);
  const status = JSON.parse(await fs.readFile(path.join(root, running.statusPath), 'utf8'));

  await stopWorker(root, 'agent-stop');

  assert.equal(isPidAlive(running.pid), false);
  assert.equal(isPidAlive(status.commandPid), false);
});

test('background agent workers resume follow-up messages through codex sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Continue agent work', now: '2026-04-18T12:00:00.000Z' });
  const { mockCodex, callLog } = await writeMockCodexSession(root);

  await startAgentWorker(root, {
    taskId: task.id,
    prompt: 'Start and wait for a follow-up.',
    id: 'agent-inbox',
    codexCommand: [process.execPath, mockCodex]
  });

  await waitForWorkerOutput(root, 'agent-inbox', /mock initial turn/);
  const sent = await sendAgentMessage(root, 'agent-inbox', 'ship status update');

  assert.equal(sent.id, 'agent-inbox');
  assert.equal(sent.message, 'ship status update');
  assert.match(sent.messagePath, /\.codepark\/workers\/agent-inbox\.messages\.ndjson$/);
  await waitForWorkerOutput(root, 'agent-inbox', /mock resume turn/);
  const read = await readWorker(root, 'agent-inbox');
  assert.match(read.output, /\[CodePark message/);
  assert.match(read.output, /mock resume turn/);
  assert.match(read.output, /ship status update/);
  const calls = await readMockCodexCalls(callLog);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], 'resume');
  await stopWorker(root, 'agent-inbox');
});

test('sendAgentMessage rejects full agent inboxes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  await fs.mkdir(path.join(root, '.codepark', 'workers'), { recursive: true });
  const worker = {
    id: 'agent-full',
    taskId: 'task-full',
    taskTitle: 'Full inbox',
    kind: 'agent',
    command: 'agentSessionRunner',
    cwd: root,
    status: 'running',
    pid: process.pid,
    exitCode: null,
    logPath: '.codepark/workers/agent-full.log',
    statusPath: '.codepark/workers/agent-full.status.json',
    messagePath: '.codepark/workers/agent-full.messages.ndjson',
    maxRuntimeMs: 10000,
    agentMaxTurns: 25,
    agentMaxQueuedMessages: 1,
    agentQueuedMessages: 1,
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(root, '.codepark', 'workers.json'), `${JSON.stringify({ version: 1, workers: [worker] }, null, 2)}\n`);
  await fs.writeFile(path.join(root, worker.statusPath), `${JSON.stringify(worker, null, 2)}\n`);
  await fs.writeFile(path.join(root, worker.logPath), 'agent output\n');

  await assert.rejects(
    () => sendAgentMessage(root, 'agent-full', 'new message'),
    /agent inbox is full/
  );
});

test('agent session runner rejects follow-ups after max turns', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Bounded agent work', now: '2026-04-18T12:00:00.000Z' });
  const { mockCodex } = await writeMockCodexSession(root);

  await startAgentWorker(root, {
    taskId: task.id,
    prompt: 'Start one-turn session.',
    id: 'agent-max-turns',
    codexCommand: [process.execPath, mockCodex],
    maxTurns: 1
  });

  await waitForWorkerOutput(root, 'agent-max-turns', /mock initial turn/);
  await sendAgentMessage(root, 'agent-max-turns', 'this should be rejected');
  const worker = await waitForWorker(root, 'agent-max-turns', worker => worker.agentRejectedMessages === 1);
  const state = JSON.parse(await fs.readFile(path.join(root, '.codepark', 'workers', 'agent-max-turns.agent-state.json'), 'utf8'));

  assert.equal(worker.agentTurns, 1);
  assert.equal(worker.agentRejectedMessages, 1);
  assert.equal(state.rejectedMessages[0].reason, 'agent max turns reached');
  await stopWorker(root, 'agent-max-turns');
});

test('background agent workers keep codex sessions alive and resume follow-ups', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  const task = await addTask(root, { title: 'Resume codex agent work', now: '2026-04-18T12:00:00.000Z' });
  const { mockCodex, callLog } = await writeMockCodexSession(root);

  await startAgentWorker(root, {
    taskId: task.id,
    prompt: 'Start a resumable session.',
    id: 'agent-session',
    codexCommand: [process.execPath, mockCodex]
  });

  await waitForWorkerOutput(root, 'agent-session', /mock initial turn/);
  let worker = (await listWorkers(root)).find(worker => worker.id === 'agent-session');
  assert.equal(worker.status, 'running');

  await sendAgentMessage(root, 'agent-session', 'continue from the same codex session');
  await waitForWorkerOutput(root, 'agent-session', /mock resume turn/);

  const calls = await readMockCodexCalls(callLog);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'exec');
  assert.ok(calls[0].includes('--json'));
  assert.equal(calls[1][0], 'exec');
  assert.equal(calls[1][1], 'resume');
  assert.ok(calls[1].includes('thread-abc'));
  assert.ok(calls[1].some(arg => arg.includes('continue from the same codex session')));

  worker = (await listWorkers(root)).find(worker => worker.id === 'agent-session');
  assert.equal(worker.status, 'running');
  assert.equal(worker.agentSessionId, 'thread-abc');
  await stopWorker(root, 'agent-session');
});

test('agent session runner replays unprocessed persisted inbox messages after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));
  await fs.mkdir(path.join(root, '.codepark', 'workers'), { recursive: true });
  const { mockCodex, callLog } = await writeMockCodexSession(root);
  const statusPath = path.join(root, '.codepark', 'workers', 'agent-replay.status.json');
  const messagePath = path.join(root, '.codepark', 'workers', 'agent-replay.messages.ndjson');
  const statePath = path.join(root, '.codepark', 'workers', 'agent-replay.agent-state.json');
  const configPath = path.join(root, '.codepark', 'workers', 'agent-replay.agent.json');
  const processed = { createdAt: '2026-04-18T12:00:00.000Z', message: 'already handled' };
  const pending = { createdAt: '2026-04-18T12:01:00.000Z', message: 'resume pending inbox' };

  await fs.writeFile(statusPath, JSON.stringify({
    id: 'agent-replay',
    taskId: 'task-replay',
    taskTitle: 'Replay inbox',
    kind: 'agent',
    command: 'agentSessionRunner',
    cwd: root,
    status: 'running',
    pid: process.pid,
    exitCode: null,
    logPath: '.codepark/workers/agent-replay.log',
    statusPath: '.codepark/workers/agent-replay.status.json',
    messagePath: '.codepark/workers/agent-replay.messages.ndjson',
    createdAt: processed.createdAt,
    updatedAt: processed.createdAt
  }));
  await fs.writeFile(messagePath, `${JSON.stringify(processed)}\n${JSON.stringify(pending)}\n`);
  await fs.writeFile(statePath, `${JSON.stringify({
    version: 1,
    agentId: 'agent-replay',
    sessionId: 'thread-abc',
    turns: [{ kind: 'initial', prompt: 'initial prompt', exitCode: 0 }],
    processedMessages: [processed]
  }, null, 2)}\n`);
  await fs.writeFile(configPath, `${JSON.stringify({
    version: 1,
    id: 'agent-replay',
    cwd: root,
    prompt: 'initial prompt',
    codexCommand: [process.execPath, mockCodex],
    messagePath,
    statusPath,
    agentStatePath: statePath
  }, null, 2)}\n`);

  const runner = spawn(process.execPath, [path.join(repoRoot, 'src', 'agentSessionRunner.js'), configPath], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await waitForAgentState(statePath, state => state.processedMessages?.length === 2);
    await waitForAgentState(statusPath, status => status.agentProcessedMessages === 2);
    const calls = await readMockCodexCalls(callLog);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'exec');
    assert.equal(calls[0][1], 'resume');
    assert.ok(calls[0].includes('thread-abc'));
    assert.ok(calls[0].some(arg => arg.includes('resume pending inbox')));
    assert.ok(calls[0].every(arg => !arg.includes('already handled')));

    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    assert.equal(state.turns.filter(turn => turn.kind === 'initial').length, 1);
    assert.equal(state.turns.filter(turn => turn.kind === 'resume').length, 1);
    assert.deepEqual(state.processedMessages.map(record => record.message), ['already handled', 'resume pending inbox']);
    const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));
    assert.equal(status.agentProcessedMessages, 2);
    assert.equal(status.agentQueuedMessages, 0);
    assert.equal(status.agentLastMessageAt, pending.createdAt);
  } finally {
    runner.kill('SIGTERM');
  }
});

test('background workers require an existing task and safe command', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-'));

  await assert.rejects(
    () => startWorker(root, { taskId: 'missing', command: 'echo nope' }),
    /task not found/
  );

  const task = await addTask(root, { title: 'Reject dangerous command', now: '2026-04-18T12:00:00.000Z' });
  await assert.rejects(
    () => startWorker(root, { taskId: task.id, command: 'rm -rf /' }),
    /blocked by command safety policy/
  );
});

async function writeMockCodex(root, lines = [
  '#!/usr/bin/env node',
  "console.log('mock codex invoked')",
  "console.log(process.argv.slice(2).join('\\n'))"
]) {
  const file = path.join(root, 'mock-codex.js');
  await fs.writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

async function writeWorkerRecords(root, records) {
  await fs.mkdir(path.join(root, '.codepark', 'workers'), { recursive: true });
  const workers = records.map((record, index) => {
    const id = record.id;
    return {
      id,
      taskId: `task-${index + 1}`,
      taskTitle: `Task ${index + 1}`,
      kind: 'shell',
      command: `node ${id}.js`,
      cwd: root,
      status: record.status,
      pid: null,
      exitCode: record.exitCode ?? null,
      logPath: `.codepark/workers/${id}.log`,
      statusPath: `.codepark/workers/${id}.status.json`,
      createdAt: '2026-04-18T12:00:00.000Z',
      updatedAt: '2026-04-18T12:01:00.000Z',
      ...(record.failureReason ? { failureReason: record.failureReason } : {})
    };
  });
  await fs.writeFile(path.join(root, '.codepark', 'workers.json'), `${JSON.stringify({ version: 1, workers }, null, 2)}\n`);
  for (const worker of workers) {
    await fs.writeFile(path.join(root, worker.statusPath), `${JSON.stringify(worker, null, 2)}\n`);
    await fs.writeFile(path.join(root, worker.logPath), `${worker.id} output\n`);
  }
}

async function writeMockCodexSession(root) {
  const callLog = path.join(root, 'mock-codex-session-calls.ndjson');
  const mockCodex = await writeMockCodex(root, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs'",
    `const callLog = ${JSON.stringify(callLog)}`,
    'const args = process.argv.slice(2)',
    "fs.appendFileSync(callLog, `${JSON.stringify(args)}\\n`)",
    "console.log(JSON.stringify({ type: 'session_configured', thread_id: 'thread-abc' }))",
    "if (args[0] === 'exec' && args[1] === 'resume') console.log('mock resume turn')",
    "else console.log('mock initial turn')"
  ]);
  return { mockCodex, callLog };
}

async function readMockCodexCalls(callLog) {
  const text = await fs.readFile(callLog, 'utf8');
  return text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function waitForAgentState(statePath, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const state = await fs.readFile(statePath, 'utf8')
      .then(text => JSON.parse(text))
      .catch(error => {
        if (error?.code === 'ENOENT') return {};
        throw error;
      });
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('agent state did not reach expected state');
}

async function waitForWorker(cwd, id, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const worker = (await listWorkers(cwd)).find(worker => worker.id === id);
    if (worker && predicate(worker)) return worker;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`worker did not reach expected state: ${id}`);
}

async function waitForWorkerOutput(cwd, id, pattern) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const worker = await readWorker(cwd, id).catch(() => null);
    if (worker && pattern.test(worker.output)) return worker;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`worker output did not match ${pattern}: ${id}`);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}
