import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseShellWords, quoteShellWords } from './shellSyntax.js';
import { writeJsonAtomic } from './atomicWrite.js';
import { CodeParkError } from './errors.js';
import { createSubprocessEnv } from './env.js';
import { evaluateWorkspaceCommandPolicy } from './workspacePolicy.js';
import { listTasks } from './tasks.js';

const workersFile = '.codepark/workers.json';
const workersDir = '.codepark/workers';
const maxLogBytes = 120000;
const stopGraceMs = 1000;
const killGraceMs = 500;
const staleWorkerGraceMs = 2000;
const defaultWorkerMaxRuntimeMs = 4 * 60 * 60 * 1000;
const defaultAgentMaxTurns = 25;
const defaultAgentMaxQueuedMessages = 50;

const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workerRunner.js');
const agentSessionRunnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agentSessionRunner.js');

export async function startWorker(cwd, options = {}) {
  const task = await resolveTaskReference(cwd, options.taskId);
  if (task.status !== 'open') throw new CodeParkError('EARGS', `task is not open: ${task.id}`);
  const command = String(options.command ?? '').trim();
  if (!command) throw new CodeParkError('EARGS', 'worker command is required');
  if (await evaluateWorkspaceCommandPolicy(cwd, command) === 'disabled') throw new CodeParkError('EARGS', 'blocked by command safety policy');

  const now = options.now ?? new Date().toISOString();
  const kind = normalizeWorkerKind(options.kind);
  const id = normalizeWorkerId(options.id) || createWorkerId(now, kind);
  const maxRuntimeMs = normalizePositiveInteger(options.maxRuntimeMs, defaultWorkerMaxRuntimeMs);
  const ledger = await readWorkerLedger(cwd);
  if (ledger.workers.some(worker => worker.id === id)) throw new CodeParkError('EARGS', `worker already exists: ${id}`);

  const logPath = toPosix(path.join(workersDir, `${id}.log`));
  const statusPath = toPosix(path.join(workersDir, `${id}.status.json`));
  const messagePath = kind === 'agent' ? toPosix(path.join(workersDir, `${id}.messages.ndjson`)) : '';
  const absoluteLogPath = path.join(cwd, logPath);
  const absoluteStatusPath = path.join(cwd, statusPath);
  await fs.mkdir(path.dirname(absoluteLogPath), { recursive: true });
  if (messagePath) await fs.writeFile(path.join(cwd, messagePath), '', { flag: 'a' });

  const worker = {
    id,
    taskId: task.id,
    taskTitle: task.title,
    kind,
    command,
    cwd,
    status: 'starting',
    pid: null,
    exitCode: null,
    logPath,
    statusPath,
    maxRuntimeMs,
    createdAt: now,
    updatedAt: now,
    ...(kind === 'agent' ? {
      agentPrompt: String(options.agentPrompt ?? '').trim(),
      messagePath,
      agentMaxTurns: normalizePositiveInteger(options.agentMaxTurns, defaultAgentMaxTurns),
      agentMaxQueuedMessages: normalizePositiveInteger(options.agentMaxQueuedMessages, defaultAgentMaxQueuedMessages),
      ...(options.agentDriver ? { agentDriver: String(options.agentDriver) } : {}),
      ...(options.agentConfigPath ? { agentConfigPath: toPosix(String(options.agentConfigPath)) } : {}),
      ...(options.agentStatePath ? { agentStatePath: toPosix(String(options.agentStatePath)) } : {})
    } : {})
  };
  await writeWorkerStatus(absoluteStatusPath, worker);

  const runnerArgs = [runnerPath, absoluteStatusPath, absoluteLogPath, cwd, command, String(maxRuntimeMs)];
  if (messagePath) runnerArgs.push(path.join(cwd, messagePath));
  const child = spawn(process.execPath, runnerArgs, {
    cwd,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: createSubprocessEnv(process.env)
  });
  child.unref();

  const runningWorker = { ...worker, status: 'running', pid: child.pid, updatedAt: new Date().toISOString() };
  await waitForRunnerStart(absoluteStatusPath, child.pid);
  ledger.workers.push(runningWorker);
  await writeWorkerLedger(cwd, ledger);
  return publicWorker(runningWorker);
}

export async function startAgentWorker(cwd, options = {}) {
  const prompt = String(options.prompt ?? '').trim();
  if (!prompt) throw new CodeParkError('EARGS', 'agent prompt is required');
  const task = await resolveTaskReference(cwd, options.taskId);
  const now = options.now ?? new Date().toISOString();
  const id = normalizeWorkerId(options.id) || createWorkerId(now, 'agent');
  const messagePath = toPosix(path.join(workersDir, `${id}.messages.ndjson`));
  const statusPath = toPosix(path.join(workersDir, `${id}.status.json`));
  const agentConfigPath = toPosix(path.join(workersDir, `${id}.agent.json`));
  const agentStatePath = toPosix(path.join(workersDir, `${id}.agent-state.json`));
  const codexCommand = normalizeCodexCommandPrefix(options.codexCommand ?? process.env.CODEPARK_CODEX_COMMAND ?? 'codex');
  await writeAgentConfig(cwd, agentConfigPath, {
    version: 1,
    id,
    cwd,
    taskId: task.id,
    taskTitle: task.title,
    prompt: formatAgentPrompt({ ...options, taskId: task.id, taskTitle: task.title, messagePath }, prompt),
    codexCommand,
    model: options.model,
    sandbox: options.sandbox ?? 'workspace-write',
    maxTurns: normalizePositiveInteger(options.maxTurns, defaultAgentMaxTurns),
    maxQueuedMessages: normalizePositiveInteger(options.maxQueuedMessages, defaultAgentMaxQueuedMessages),
    messagePath: path.join(cwd, messagePath),
    statusPath: path.join(cwd, statusPath),
    agentStatePath: path.join(cwd, agentStatePath)
  });
  const command = buildCodexAgentCommand(cwd, prompt, {
    ...options,
    id,
    taskId: task.id,
    taskTitle: task.title,
    messagePath,
    agentConfigPath
  });
  return startWorker(cwd, {
    taskId: task.id,
    id,
    now,
    command,
    kind: 'agent',
    agentPrompt: prompt,
    agentDriver: 'codex-session',
    agentMaxTurns: normalizePositiveInteger(options.maxTurns, defaultAgentMaxTurns),
    agentMaxQueuedMessages: normalizePositiveInteger(options.maxQueuedMessages, defaultAgentMaxQueuedMessages),
    maxRuntimeMs: normalizePositiveInteger(options.maxRuntimeMs, defaultWorkerMaxRuntimeMs),
    agentConfigPath,
    agentStatePath
  });
}

export async function listWorkers(cwd, options = {}) {
  const ledger = await readWorkerLedger(cwd);
  const workers = [];
  for (const worker of ledger.workers) {
    workers.push(await hydrateWorker(cwd, worker));
  }
  const taskId = String(options.taskId ?? '').trim();
  const filtered = taskId ? workers.filter(worker => worker.taskId.startsWith(taskId)) : workers;
  await writeWorkerLedger(cwd, { version: 1, workers });
  return filtered.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function readWorker(cwd, id, options = {}) {
  const worker = await resolveWorker(cwd, id);
  const logPath = path.join(cwd, worker.logPath);
  const buffer = await fs.readFile(logPath).catch(error => {
    if (error?.code === 'ENOENT') return Buffer.from('');
    throw error;
  });
  const maxBytes = Math.max(1000, Math.min(Number(options.maxBytes ?? maxLogBytes), maxLogBytes));
  const start = Math.max(0, buffer.length - maxBytes);
  const output = applyTailLines(buffer.subarray(start).toString('utf8'), options.tailLines);
  return {
    ...worker,
    output,
    truncated: start > 0
  };
}

export async function sendAgentMessage(cwd, id, message, options = {}) {
  const text = String(message ?? '').trim();
  if (!text) throw new CodeParkError('EARGS', 'agent message is required');
  const ledger = await readWorkerLedger(cwd);
  const ledgerWorker = resolveWorkerFromList(ledger.workers, id);
  const worker = await hydrateWorker(cwd, ledgerWorker);
  if (worker.kind !== 'agent') throw new CodeParkError('EARGS', `worker is not an agent: ${worker.id}`);
  if (worker.status !== 'running' && worker.status !== 'starting') {
    throw new CodeParkError('EARGS', `agent is not running: ${worker.id}`);
  }
  if (worker.agentMaxQueuedMessages && worker.agentQueuedMessages >= worker.agentMaxQueuedMessages) {
    throw new CodeParkError('EARGS', `agent inbox is full: ${worker.id}`);
  }

  const now = options.now ?? new Date().toISOString();
  const messagePath = worker.messagePath || toPosix(path.join(workersDir, `${worker.id}.messages.ndjson`));
  const absoluteMessagePath = path.join(cwd, messagePath);
  const record = { createdAt: now, message: text };
  const updatedWorker = {
    ...worker,
    messagePath,
    lastMessageAt: now,
    updatedAt: now
  };
  await writeWorkerStatus(path.join(cwd, updatedWorker.statusPath), updatedWorker);
  const nextWorkers = ledger.workers.map(entry => entry.id === worker.id ? updatedWorker : entry);
  await writeWorkerLedger(cwd, { version: 1, workers: nextWorkers });
  await fs.mkdir(path.dirname(absoluteMessagePath), { recursive: true });
  await fs.appendFile(absoluteMessagePath, `${JSON.stringify(record)}\n`);
  await appendWorkerLog(cwd, worker, formatPersistedAgentMessage(record));

  return {
    id: worker.id,
    taskId: worker.taskId,
    message: text,
    messagePath,
    createdAt: now
  };
}

export async function stopWorker(cwd, id) {
  const ledger = await readWorkerLedger(cwd);
  const worker = resolveWorkerFromList(ledger.workers, id);
  const hydrated = await hydrateWorker(cwd, worker);
  if (hydrated.status === 'running' || hydrated.status === 'starting') {
    await terminateProcessGroup(hydrated.pid);
  }
  const stopped = {
    ...hydrated,
    status: 'stopped',
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  };
  await writeWorkerStatus(path.join(cwd, stopped.statusPath), stopped);
  const next = ledger.workers.map(entry => entry.id === stopped.id ? stopped : entry);
  await writeWorkerLedger(cwd, { version: 1, workers: next });
  return publicWorker(stopped);
}

export async function pruneWorkers(cwd, options = {}) {
  const ledger = await readWorkerLedger(cwd);
  const hydrated = [];
  for (const worker of ledger.workers) {
    hydrated.push(await hydrateWorker(cwd, worker));
  }
  const includeRunning = Boolean(options.includeRunning);
  const failedOnly = Boolean(options.failedOnly);
  const removed = [];
  const kept = [];
  for (const worker of hydrated) {
    if (failedOnly && worker.status !== 'failed') {
      kept.push(worker);
      continue;
    }
    if (!includeRunning && (worker.status === 'running' || worker.status === 'starting')) {
      kept.push(worker);
      continue;
    }
    if (worker.status === 'running' || worker.status === 'starting') {
      await terminateProcessGroup(worker.pid);
    }
    removed.push(worker);
  }
  for (const worker of removed) {
    await fs.rm(path.join(cwd, worker.logPath), { force: true }).catch(() => {});
    await fs.rm(path.join(cwd, worker.statusPath), { force: true }).catch(() => {});
    if (worker.kind === 'agent') {
      if (worker.messagePath) await fs.rm(path.join(cwd, worker.messagePath), { force: true }).catch(() => {});
      if (worker.agentConfigPath) await fs.rm(path.join(cwd, worker.agentConfigPath), { force: true }).catch(() => {});
      if (worker.agentStatePath) await fs.rm(path.join(cwd, worker.agentStatePath), { force: true }).catch(() => {});
    }
  }
  await writeWorkerLedger(cwd, { version: 1, workers: kept });
  return { removed, kept };
}

export function formatWorkerStarted(worker) {
  const label = worker.kind === 'agent' ? 'Agent started' : 'Worker started';
  return [
    `${label}: ${worker.id}`,
    `task: ${worker.taskId}`,
    `type: ${worker.kind}`,
    `status: ${worker.status}`,
    `pid: ${worker.pid}`,
    `log: ${worker.logPath}`
  ].join('\n');
}

export function formatWorkerList(workers) {
  if (!workers.length) return 'No workers.';
  return workers.map(worker => [
    worker.id,
    worker.kind,
    worker.status,
    worker.taskId,
    `exit: ${worker.exitCode ?? 'n/a'}`,
    worker.failureReason ? `reason: ${worker.failureReason}` : '',
    worker.command
  ].filter(Boolean).join(' | ')).join('\n');
}

export function formatWorkerListJson(workers) {
  return JSON.stringify({ version: 1, workers }, null, 2);
}

export function formatWorkerRead(worker) {
  const output = worker.output.trim() || '[no output]';
  return [
    `Worker: ${worker.id}`,
    `task: ${worker.taskId}`,
    `status: ${worker.status}`,
    `exit: ${worker.exitCode ?? 'n/a'}`,
    worker.failureReason ? `reason: ${worker.failureReason}` : '',
    worker.truncated ? '[log truncated]' : '',
    output
  ].filter(Boolean).join('\n');
}

export function formatWorkerReadClean(worker) {
  const output = cleanWorkerOutput(worker.output).trim() || '[no output]';
  return formatWorkerRead({ ...worker, output });
}

export function formatWorkerReadJson(worker, options = {}) {
  return JSON.stringify({
    version: 1,
    ...worker,
    output: options.clean ? cleanWorkerOutput(worker.output) : worker.output
  }, null, 2);
}

export function cleanWorkerOutput(output) {
  const lines = String(output ?? '').split(/\r?\n/);
  const cleaned = [];
  for (const line of lines) {
    const value = cleanWorkerLogLine(line);
    if (value) cleaned.push(value);
  }
  return cleaned.join('\n');
}

function cleanWorkerLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return line;
  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return line;
  }
  if (!event || typeof event !== 'object' || !event.type) return line;

  const type = String(event.type);
  if (type === 'session_configured' || type === 'session.created' || type === 'thread.started') {
    const sessionId = event.thread_id || event.session_id || event.id;
    return sessionId ? `[codex session: ${sessionId}]` : '[codex session configured]';
  }
  if (type === 'turn.started') return '[codex turn started]';
  if (type === 'turn.completed') return '[codex turn completed]';
  if (type === 'error' || type.endsWith('.error')) {
    const message = event.message || event.error?.message || event.error;
    return message ? `[codex error: ${message}]` : '[codex error]';
  }

  const text = extractCodexEventText(event);
  return text || '';
}

function extractCodexEventText(event) {
  const values = [];
  collectCodexText(event.item ?? event.message ?? event.delta ?? event.response ?? event, values);
  return values.join('\n').trim();
}

function collectCodexText(value, values) {
  if (value == null) return;
  if (typeof value === 'string') {
    values.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectCodexText(entry, values);
    return;
  }
  if (typeof value !== 'object') return;

  if (typeof value.text === 'string') values.push(value.text);
  if (typeof value.content === 'string') values.push(value.content);

  for (const key of ['content', 'parts', 'output', 'message', 'delta']) {
    if (Object.hasOwn(value, key) && typeof value[key] !== 'string') {
      collectCodexText(value[key], values);
    }
  }
}

export function formatAgentMessageSent(result) {
  return [
    `Agent message sent: ${result.id}`,
    `task: ${result.taskId}`,
    `message: ${result.message}`,
    `inbox: ${result.messagePath}`
  ].join('\n');
}

export function formatWorkerStopped(worker) {
  return [
    `Worker stopped: ${worker.id}`,
    `status: ${worker.status}`
  ].join('\n');
}

export function formatWorkerPruned(result) {
  return [
    'Workers pruned:',
    `removed: ${result.removed.length}`,
    `kept: ${result.kept.length}`
  ].join('\n');
}

export function formatWorkerPrunedJson(result) {
  return JSON.stringify({
    version: 1,
    removed: result.removed,
    kept: result.kept
  }, null, 2);
}

async function resolveTaskReference(cwd, taskId) {
  const needle = String(taskId ?? '').trim();
  if (!needle) throw new CodeParkError('EARGS', 'task id is required');
  const tasks = await listTasks(cwd);
  const exact = tasks.find(task => task.id === needle);
  if (exact) return exact;
  const matches = tasks.filter(task => task.id.startsWith(needle));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new CodeParkError('EARGS', `task id prefix is ambiguous: ${needle}`);
  throw new CodeParkError('EARGS', `task not found: ${needle}`);
}

async function resolveWorker(cwd, id) {
  const ledger = await readWorkerLedger(cwd);
  const worker = resolveWorkerFromList(ledger.workers, id);
  return hydrateWorker(cwd, worker);
}

function resolveWorkerFromList(workers, id) {
  const needle = String(id ?? '').trim();
  if (!needle) throw new CodeParkError('EARGS', 'worker id is required');
  const exact = workers.find(worker => worker.id === needle);
  if (exact) return exact;
  const matches = workers.filter(worker => worker.id.startsWith(needle));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new CodeParkError('EARGS', `worker id prefix is ambiguous: ${needle}`);
  throw new CodeParkError('EARGS', `worker not found: ${needle}`);
}

async function hydrateWorker(cwd, worker) {
  const status = await readJsonFile(path.join(cwd, worker.statusPath)).catch(() => ({}));
  const merged = normalizeWorker({ ...worker, ...status });
  if ((merged.status === 'running' || merged.status === 'starting') && merged.pid && !isProcessAlive(merged.pid)) {
    if (isRecentlyUpdated(merged.updatedAt, staleWorkerGraceMs)) return publicWorker(merged);
    const now = new Date().toISOString();
    const recovered = {
      ...merged,
      status: 'failed',
      failureReason: 'process not found',
      updatedAt: now,
      finishedAt: merged.finishedAt || now
    };
    await writeWorkerStatus(path.join(cwd, recovered.statusPath), recovered);
    return publicWorker(recovered);
  }
  return publicWorker(merged);
}

function isRecentlyUpdated(value, maxAgeMs) {
  const time = Date.parse(String(value ?? ''));
  if (!Number.isFinite(time)) return false;
  return Date.now() - time < maxAgeMs;
}

async function readWorkerLedger(cwd) {
  const file = path.join(cwd, workersFile);
  const text = await fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  if (!text) return { version: 1, workers: [] };
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.workers)) {
    throw new CodeParkError('ERROR', `${workersFile} is not a valid CodePark worker ledger`);
  }
  return {
    version: 1,
    workers: parsed.workers.map(normalizeWorker)
  };
}

async function writeWorkerLedger(cwd, ledger) {
  const file = path.join(cwd, workersFile);
  await writeJsonAtomic(file, { version: 1, workers: ledger.workers.map(normalizeWorker) });
}

async function writeWorkerStatus(file, worker) {
  await writeJsonAtomic(file, normalizeWorker(worker));
}

async function writeAgentConfig(cwd, relativePath, config) {
  const file = path.join(cwd, relativePath);
  await writeJsonAtomic(file, config);
}

async function appendWorkerLog(cwd, worker, value) {
  await fs.mkdir(path.dirname(path.join(cwd, worker.logPath)), { recursive: true });
  await fs.appendFile(path.join(cwd, worker.logPath), value);
}

async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function waitForRunnerStart(statusPath, pid) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const status = await readJsonFile(statusPath).catch(() => null);
    if (status?.pid === pid || status?.finishedAt) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function normalizeWorker(worker) {
  const id = normalizeWorkerId(worker.id);
  if (!id) throw new CodeParkError('EARGS', 'worker id is required');
  const taskId = String(worker.taskId ?? '').trim();
  if (!taskId) throw new CodeParkError('EARGS', 'worker task id is required');
  const command = String(worker.command ?? '').trim();
  if (!command) throw new CodeParkError('EARGS', 'worker command is required');
  const status = normalizeWorkerStatus(worker.status);
  const kind = normalizeWorkerKind(worker.kind);
  return {
    id,
    taskId,
    taskTitle: String(worker.taskTitle ?? ''),
    kind,
    command,
    cwd: String(worker.cwd ?? ''),
    status,
    pid: worker.pid == null ? null : Number(worker.pid),
    exitCode: worker.exitCode == null ? null : Number(worker.exitCode),
    ...(worker.failureReason ? { failureReason: String(worker.failureReason) } : {}),
    logPath: normalizeRelativePath(worker.logPath),
    statusPath: normalizeRelativePath(worker.statusPath),
    maxRuntimeMs: normalizePositiveInteger(worker.maxRuntimeMs, defaultWorkerMaxRuntimeMs),
    createdAt: String(worker.createdAt ?? ''),
    updatedAt: String(worker.updatedAt ?? ''),
    ...(kind === 'agent' ? {
      agentPrompt: String(worker.agentPrompt ?? ''),
      ...(worker.messagePath ? { messagePath: normalizeRelativePath(worker.messagePath) } : {}),
      agentMaxTurns: normalizePositiveInteger(worker.agentMaxTurns, defaultAgentMaxTurns),
      agentMaxQueuedMessages: normalizePositiveInteger(worker.agentMaxQueuedMessages, defaultAgentMaxQueuedMessages),
      ...(worker.lastMessageAt ? { lastMessageAt: String(worker.lastMessageAt) } : {}),
      ...(worker.agentDriver ? { agentDriver: String(worker.agentDriver) } : {}),
      ...(worker.agentConfigPath ? { agentConfigPath: normalizeRelativePath(worker.agentConfigPath) } : {}),
      ...(worker.agentStatePath ? { agentStatePath: normalizeRelativePath(worker.agentStatePath) } : {}),
      ...(worker.agentSessionId ? { agentSessionId: String(worker.agentSessionId) } : {}),
      ...(worker.agentTurns == null ? {} : { agentTurns: Number(worker.agentTurns) }),
      ...(worker.agentLastTurnAt ? { agentLastTurnAt: String(worker.agentLastTurnAt) } : {}),
      ...(worker.agentQueuedMessages == null ? {} : { agentQueuedMessages: Number(worker.agentQueuedMessages) }),
      ...(worker.agentProcessedMessages == null ? {} : { agentProcessedMessages: Number(worker.agentProcessedMessages) }),
      ...(worker.agentRejectedMessages == null ? {} : { agentRejectedMessages: Number(worker.agentRejectedMessages) }),
      ...(worker.agentLastMessageAt ? { agentLastMessageAt: String(worker.agentLastMessageAt) } : {})
    } : {}),
    ...(worker.finishedAt ? { finishedAt: String(worker.finishedAt) } : {})
  };
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) return number;
  return fallback;
}

function publicWorker(worker) {
  return normalizeWorker(worker);
}

function normalizeWorkerStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (['starting', 'running', 'done', 'failed', 'stopped'].includes(status)) return status;
  throw new CodeParkError('EARGS', 'worker status must be starting, running, done, failed, or stopped');
}

function normalizeWorkerKind(value) {
  const kind = String(value ?? 'shell').trim().toLowerCase();
  if (kind === 'shell' || kind === 'agent') return kind;
  throw new CodeParkError('EARGS', 'worker kind must be shell or agent');
}

function normalizeWorkerId(value) {
  const id = String(value ?? '').trim();
  if (!id) return '';
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw new CodeParkError('EARGS', 'worker id may contain only letters, numbers, dot, underscore, and dash');
  }
  return id;
}

function normalizeRelativePath(value) {
  const relative = toPosix(String(value ?? '').trim());
  if (!relative || relative.startsWith('/') || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new CodeParkError('EARGS', 'worker paths must be relative paths without dot segments');
  }
  return relative;
}

function createWorkerId(now, kind = 'shell') {
  const stamp = String(now).replace(/\D/g, '').slice(0, 14) || Date.now();
  const prefix = kind === 'agent' ? 'agent' : 'worker';
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildCodexAgentCommand(cwd, prompt, options = {}) {
  return quoteShellWords([
    process.execPath,
    agentSessionRunnerPath,
    path.join(cwd, String(options.agentConfigPath ?? ''))
  ]);
}

function normalizeCodexCommandPrefix(value) {
  const parts = Array.isArray(value) ? value : parseShellWords(value);
  if (parts.some(part => typeof part !== 'string')) {
    throw new CodeParkError('EARGS', 'codex command may not contain shell operators');
  }
  const normalized = parts.map(part => String(part ?? '').trim()).filter(Boolean);
  if (!normalized.length) throw new CodeParkError('EARGS', 'codex command is required');
  return normalized;
}

function formatAgentPrompt(options, prompt) {
  return [
    'You are a task-scoped CodePark background subagent running through Codex CLI.',
    'Work autonomously in the current workspace. Keep edits focused, verify your work, and finish with a concise summary.',
    'CodePark may send follow-up messages while you run. If your stdin receives a "[CodePark follow-up]" block, treat it as the latest user instruction for this task.',
    ...(options.messagePath ? [`Follow-up inbox: ${String(options.messagePath).trim()}`] : []),
    '',
    `Task id: ${String(options.taskId ?? '').trim()}`,
    `Task title: ${String(options.taskTitle ?? '').trim() || '(available in CodePark worker metadata)'}`,
    '',
    'User request:',
    prompt
  ].join('\n');
}

function formatPersistedAgentMessage(record) {
  return `\n[CodePark message @ ${record.createdAt}]\n${record.message}\n`;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function terminateProcessGroup(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    signalWindowsProcessTree(pid, { force: false });
    if (await waitForProcessGroupExit(pid, stopGraceMs)) return;
    signalWindowsProcessTree(pid, { force: true });
    await waitForProcessGroupExit(pid, killGraceMs);
    return;
  }
  signalProcessGroup(pid, 'SIGTERM');
  if (await waitForProcessGroupExit(pid, stopGraceMs)) return;
  signalProcessGroup(pid, 'SIGKILL');
  await waitForProcessGroupExit(pid, killGraceMs);
}

function signalProcessGroup(pid, signal) {
  try {
    if (process.platform !== 'win32') process.kill(-pid, signal);
    else process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessGroupAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return !isProcessGroupAlive(pid);
}

function isProcessGroupAlive(pid) {
  try {
    if (process.platform !== 'win32') process.kill(-pid, 0);
    else process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function signalWindowsProcessTree(pid, options = {}) {
  if (process.platform !== 'win32') return;
  const force = Boolean(options.force);
  const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])];
  const result = spawnSync('taskkill', args, {
    stdio: 'ignore',
    windowsHide: true
  });
  // taskkill exits non-zero for already-exited processes; treat as best-effort.
  if (result.error) {
    const code = result.error?.code;
    if (code !== 'ENOENT') throw result.error;
  }
}

function applyTailLines(output, tailLines) {
  if (tailLines == null || tailLines === '') return output;
  const count = Number(tailLines);
  if (!Number.isInteger(count) || count <= 0) throw new CodeParkError('EARGS', 'tail lines must be a positive integer');
  const trimmed = String(output ?? '').replace(/\r?\n$/, '');
  if (!trimmed) return '';
  return `${trimmed.split(/\r?\n/).slice(-count).join('\n')}\n`;
}

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}
