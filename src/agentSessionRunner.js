#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeJsonAtomic } from './atomicWrite.js';
import { createSubprocessEnv } from './env.js';
import { formatCodexProgressMessage, readCodexProgressIntervalMs } from './codexProgress.js';

const [configPath] = process.argv.slice(2);

if (!configPath) {
  process.stderr.write('agentSessionRunner requires a config path\n');
  process.exit(2);
}

const config = await readConfig(configPath);
const state = await readJson(config.agentStatePath).catch(() => ({
  version: 1,
  agentId: config.id,
  sessionId: '',
  turns: [],
  processedMessages: []
}));
normalizeState();

let activeChild = null;
let running = false;
const queue = [];
const queuedMessageKeys = new Set();
const processedMessageKeys = new Set(state.processedMessages.map(messageKey));
let inputBuffer = '';
let inputTimer = null;

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  if (inputTimer) clearTimeout(inputTimer);
  inputTimer = setTimeout(flushInputBuffer, 25);
});
process.stdin.resume();

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (!hasCompletedInitialTurn()) {
  running = true;
  const initial = await runTurn('initial', config.prompt);
  running = false;
  if (initial.exitCode !== 0) process.exit(initial.exitCode ?? 1);
}
await replayPersistedInbox();
process.stdout.write(`[CodePark agent session ready${state.sessionId ? `: ${state.sessionId}` : ''}]\n`);
await updateWorkerStatus({
  agentDriver: 'codex-session',
  agentSessionId: state.sessionId || '',
  agentTurns: state.turns.length,
  agentQueuedMessages: queue.length,
  agentProcessedMessages: state.processedMessages.length,
  ...(state.processedMessages.at(-1)?.createdAt ? { agentLastMessageAt: state.processedMessages.at(-1).createdAt } : {}),
  updatedAt: new Date().toISOString()
});
await drainQueue();

async function flushInputBuffer() {
  const text = inputBuffer;
  inputBuffer = '';
  inputTimer = null;
  for (const message of extractFollowUpMessages(text)) {
    enqueueMessage(message);
  }
  await updateMessageStatus();
  await drainQueue();
}

async function drainQueue() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      if (turnLimitReached()) {
        await rejectQueuedMessages('agent max turns reached');
        break;
      }
      const record = queue.shift();
      queuedMessageKeys.delete(messageKey(record));
      await updateMessageStatus();
      const result = await runTurn('resume', record.message);
      if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
      await markMessageProcessed(record);
    }
  } finally {
    running = false;
  }
}

async function runTurn(kind, prompt) {
  if (turnLimitReached()) {
    const message = `agent max turns reached: ${config.maxTurns}`;
    process.stderr.write(`[CodePark ${message}]\n`);
    await updateWorkerStatus({
      status: 'failed',
      failureReason: message,
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    });
    return { exitCode: 1, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
  }
  const args = buildCodexArgs(kind, prompt);
  process.stdout.write(`\n[CodePark agent ${kind}: ${args.join(' ')}]\n`);
  const result = await runCommand(config.codexCommand, args);
  state.turns.push({
    kind,
    prompt,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt
  });
  await writeState();
  await updateWorkerStatus({
    agentDriver: 'codex-session',
    agentSessionId: state.sessionId || '',
    agentTurns: state.turns.length,
    agentLastTurnAt: result.finishedAt,
    updatedAt: new Date().toISOString()
  });
  return result;
}

function buildCodexArgs(kind, prompt) {
  if (kind === 'resume') {
    const args = [
      'exec',
      'resume',
      '--json',
      '--skip-git-repo-check'
    ];
    const model = String(config.model ?? '').trim();
    if (model) args.push('--model', model);
    if (state.sessionId) args.push(state.sessionId);
    else args.push('--last');
    args.push(prompt);
    return args;
  }

  const args = [
    'exec',
    '--cd',
    config.cwd,
    '--sandbox',
    String(config.sandbox ?? 'workspace-write'),
    '--skip-git-repo-check',
    '--color',
    'never',
    '--json'
  ];
  const model = String(config.model ?? '').trim();
  if (model) args.push('--model', model);
  args.push(prompt);
  return args;
}

function runCommand(prefix, args) {
  return new Promise(resolve => {
    const startedAt = new Date().toISOString();
    const startedTime = Date.now();
    const [command, ...prefixArgs] = prefix;
    activeChild = spawn(command, [...prefixArgs, ...args], {
      cwd: config.cwd,
      env: createSubprocessEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let jsonBuffer = '';
    const progressIntervalMs = readCodexProgressIntervalMs();
    let progressTimer;
    let settled = false;
    if (progressIntervalMs > 0) {
      progressTimer = setInterval(() => {
        process.stdout.write(`[${formatCodexProgressMessage(Date.now() - startedTime)}]\n`);
      }, progressIntervalMs);
      progressTimer.unref?.();
    }

    const finish = result => {
      if (settled) return;
      settled = true;
      if (progressTimer) clearInterval(progressTimer);
      activeChild = null;
      resolve(result);
    };

    activeChild.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      jsonBuffer = parseJsonLines(`${jsonBuffer}${chunk.toString('utf8')}`);
    });
    activeChild.stderr.on('data', chunk => {
      process.stderr.write(chunk);
    });
    activeChild.on('error', error => {
      process.stderr.write(`${error.message}\n`);
      finish({ exitCode: 1, startedAt, finishedAt: new Date().toISOString() });
    });
    activeChild.on('exit', code => {
      if (jsonBuffer.trim()) parseJsonLines(`${jsonBuffer}\n`);
      finish({ exitCode: code ?? 0, startedAt, finishedAt: new Date().toISOString() });
    });
  });
}

function parseJsonLines(text) {
  const lines = text.split(/\r?\n/);
  const remainder = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const sessionId = findSessionId(event);
    if (sessionId) state.sessionId = sessionId;
  }
  return remainder;
}

function findSessionId(value) {
  if (!value || typeof value !== 'object') return '';
  for (const key of ['thread_id', 'threadId', 'session_id', 'sessionId']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  for (const child of Object.values(value)) {
    const candidate = findSessionId(child);
    if (candidate) return candidate;
  }
  return '';
}

function extractFollowUpMessages(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized) return [];
  const marker = /\[CodePark follow-up @ [^\]]+\]\n/g;
  const matches = [...normalized.matchAll(marker)];
  if (!matches.length) return [createMessageRecord({ message: normalized })];
  return matches.map((match, index) => {
    const createdAt = match[0].match(/\[CodePark follow-up @ ([^\]]+)\]/)?.[1] ?? '';
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    return createMessageRecord({
      createdAt,
      message: normalized.slice(start, end).trim()
    });
  }).filter(Boolean);
}

async function replayPersistedInbox() {
  if (!config.messagePath) return;
  const text = await fs.readFile(config.messagePath, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    enqueueMessage(parseMessageRecord(line));
  }
  await updateMessageStatus();
}

function enqueueMessage(record) {
  const normalized = createMessageRecord(record);
  if (!normalized.message) return;
  const key = messageKey(normalized);
  if (processedMessageKeys.has(key) || queuedMessageKeys.has(key)) return;
  if (queue.length >= config.maxQueuedMessages) {
    state.rejectedMessages.push({ ...normalized, reason: 'agent inbox full' });
    process.stderr.write('[CodePark agent inbox full; rejected follow-up]\n');
    return;
  }
  queue.push(normalized);
  queuedMessageKeys.add(key);
}

async function rejectQueuedMessages(reason) {
  while (queue.length) {
    const record = queue.shift();
    queuedMessageKeys.delete(messageKey(record));
    state.rejectedMessages.push({ ...record, reason });
  }
  await writeState();
  await updateMessageStatus();
}

async function markMessageProcessed(record) {
  const normalized = createMessageRecord(record);
  const key = messageKey(normalized);
  if (!processedMessageKeys.has(key)) {
    processedMessageKeys.add(key);
    state.processedMessages.push(normalized);
    if (state.processedMessages.length > 1000) {
      state.processedMessages = state.processedMessages.slice(-1000);
    }
    await writeState();
  }
  await updateMessageStatus();
}

async function updateMessageStatus() {
  await updateWorkerStatus({
    agentQueuedMessages: queue.length,
    agentProcessedMessages: state.processedMessages.length,
    agentRejectedMessages: state.rejectedMessages.length,
    ...(state.processedMessages.at(-1)?.createdAt ? { agentLastMessageAt: state.processedMessages.at(-1).createdAt } : {}),
    updatedAt: new Date().toISOString()
  });
}

function parseMessageRecord(line) {
  try {
    return createMessageRecord(JSON.parse(line));
  } catch {
    return createMessageRecord({ message: line });
  }
}

function createMessageRecord(record) {
  return {
    createdAt: String(record?.createdAt ?? '').trim() || new Date().toISOString(),
    message: String(record?.message ?? '').trim()
  };
}

function messageKey(record) {
  const normalized = createMessageRecord(record);
  return `${normalized.createdAt}\0${normalized.message}`;
}

function hasCompletedInitialTurn() {
  return state.turns.some(turn => turn.kind === 'initial' && Number(turn.exitCode) === 0);
}

function normalizeState() {
  state.version = 1;
  state.agentId = String(state.agentId ?? config.id);
  state.sessionId = String(state.sessionId ?? '');
  state.turns = Array.isArray(state.turns) ? state.turns : [];
  state.processedMessages = Array.isArray(state.processedMessages)
    ? state.processedMessages.map(createMessageRecord).filter(record => record.message)
    : [];
  state.rejectedMessages = Array.isArray(state.rejectedMessages)
    ? state.rejectedMessages.map(record => ({
      ...createMessageRecord(record),
      reason: String(record?.reason ?? '').trim() || 'rejected'
    })).filter(record => record.message)
    : [];
}

function turnLimitReached() {
  return state.turns.length >= config.maxTurns;
}

async function updateWorkerStatus(patch) {
  if (!config.statusPath) return;
  const current = await readJson(config.statusPath).catch(() => ({}));
  await writeJsonAtomic(config.statusPath, { ...current, ...patch });
}

async function writeState() {
  await writeJsonAtomic(config.agentStatePath, state);
}

async function readConfig(file) {
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  const codexCommand = Array.isArray(raw.codexCommand)
    ? raw.codexCommand.map(part => String(part ?? '').trim()).filter(Boolean)
    : [];
  if (!codexCommand.length) throw new Error('agent config requires codexCommand');
  return {
    ...raw,
    codexCommand,
    cwd: String(raw.cwd ?? process.cwd()),
    prompt: String(raw.prompt ?? ''),
    maxTurns: normalizePositiveInteger(raw.maxTurns, 25),
    maxQueuedMessages: normalizePositiveInteger(raw.maxQueuedMessages, 50),
    agentStatePath: String(raw.agentStatePath ?? ''),
    messagePath: raw.messagePath ? String(raw.messagePath) : ''
  };
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) return number;
  return fallback;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function shutdown(signal) {
  if (activeChild && !activeChild.killed) activeChild.kill(signal);
  process.exit(signal === 'SIGINT' ? 130 : 0);
}
