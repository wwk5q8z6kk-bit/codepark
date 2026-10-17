import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './atomicWrite.js';
import { CodeParkError } from './errors.js';

const taskFile = '.codepark/tasks.json';

export async function addTask(cwd, options = {}) {
  const title = String(options.title ?? '').trim();
  if (!title) throw new CodeParkError('EARGS', 'task title is required');
  const now = options.now ?? new Date().toISOString();
  const ledger = await readLedger(cwd);
  const dependsOn = resolveTaskReferences(ledger.tasks, options.dependsOn);
  const task = {
    id: createTaskId(now, ledger.tasks.length + 1),
    title,
    status: 'open',
    priority: normalizePriority(options.priority),
    dependsOn,
    labels: normalizeStringList(options.labels),
    ...(normalizeOptionalText(options.notes ?? options.note, 'task notes') ? { notes: normalizeOptionalText(options.notes ?? options.note, 'task notes') } : {}),
    createdAt: now,
    updatedAt: now
  };
  ledger.tasks.push(task);
  await writeLedger(cwd, ledger);
  return task;
}

export async function listTasks(cwd, options = {}) {
  const ledger = await readLedger(cwd);
  const status = normalizeStatus(options.status, { allowEmpty: true });
  const priority = normalizePriority(options.priority, { allowEmpty: true });
  const label = String(options.label ?? '').trim();
  let tasks = status === 'blocked'
    ? ledger.tasks.filter(task => task.status === 'open' && blockedBy(task, ledger.tasks).length)
    : status
      ? ledger.tasks.filter(task => task.status === status)
      : ledger.tasks;
  if (priority) tasks = tasks.filter(task => task.priority === priority);
  if (label) tasks = tasks.filter(task => task.labels.includes(label));
  return tasks
    .map(task => ({ ...task, blockedBy: blockedBy(task, ledger.tasks) }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getTask(cwd, id) {
  const ledger = await readLedger(cwd);
  const task = resolveTask(ledger.tasks, id);
  return { ...task, blockedBy: blockedBy(task, ledger.tasks) };
}

export async function completeTask(cwd, id, options = {}) {
  const ledger = await readLedger(cwd);
  const task = resolveTask(ledger.tasks, id);
  const now = options.now ?? new Date().toISOString();
  task.status = 'done';
  task.updatedAt = now;
  task.completedAt = now;
  await writeLedger(cwd, ledger);
  return task;
}

export async function reopenTask(cwd, id, options = {}) {
  const ledger = await readLedger(cwd);
  const task = resolveTask(ledger.tasks, id);
  const now = options.now ?? new Date().toISOString();
  task.status = 'open';
  task.updatedAt = now;
  delete task.completedAt;
  await writeLedger(cwd, ledger);
  return task;
}

export async function updateTask(cwd, id, updates = {}, options = {}) {
  const ledger = await readLedger(cwd);
  const task = resolveTask(ledger.tasks, id);
  const now = options.now ?? new Date().toISOString();

  if (Object.hasOwn(updates, 'title')) {
    const title = String(updates.title ?? '').trim();
    if (!title) throw new CodeParkError('EARGS', 'task title is required');
    task.title = title;
  }
  if (Object.hasOwn(updates, 'priority')) {
    task.priority = normalizePriority(updates.priority);
  }
  if (Object.hasOwn(updates, 'dependsOn')) {
    task.dependsOn = resolveTaskReferences(ledger.tasks, updates.dependsOn, { excludeId: task.id });
  }
  if (Object.hasOwn(updates, 'labels')) {
    task.labels = normalizeStringList(updates.labels);
  }
  if (Object.hasOwn(updates, 'notes') || Object.hasOwn(updates, 'note')) {
    const notes = normalizeOptionalText(updates.notes ?? updates.note, 'task notes');
    if (notes) task.notes = notes;
    else delete task.notes;
  }

  task.updatedAt = now;
  await writeLedger(cwd, ledger);
  return task;
}

export function formatTaskAdded(task) {
  return [
    'Task added:',
    `id: ${task.id}`,
    `status: ${task.status}`,
    `title: ${task.title}`,
    ...formatTaskMetadataLines(task)
  ].join('\n');
}

export function formatTaskCompleted(task) {
  return [
    'Task completed:',
    `id: ${task.id}`,
    `status: ${task.status}`,
    `title: ${task.title}`
  ].join('\n');
}

export function formatTaskReopened(task) {
  return [
    'Task reopened:',
    `id: ${task.id}`,
    `status: ${task.status}`,
    `title: ${task.title}`
  ].join('\n');
}

export function formatTaskUpdated(task) {
  return [
    'Task updated:',
    `id: ${task.id}`,
    `status: ${task.status}`,
    `title: ${task.title}`,
    ...formatTaskMetadataLines(task)
  ].join('\n');
}

export function formatTaskDetails(task) {
  return [
    'Task detail:',
    `id: ${task.id}`,
    `status: ${task.status}`,
    `title: ${task.title}`,
    `priority: ${task.priority}`,
    task.dependsOn?.length ? `dependsOn: ${task.dependsOn.join(',')}` : '',
    task.blockedBy?.length ? `blockedBy: ${task.blockedBy.join(',')}` : '',
    task.labels?.length ? `labels: ${task.labels.join(',')}` : '',
    task.notes ? `notes: ${task.notes}` : '',
    `createdAt: ${task.createdAt}`,
    `updatedAt: ${task.updatedAt}`,
    task.completedAt ? `completedAt: ${task.completedAt}` : ''
  ].filter(Boolean).join('\n');
}

export function formatTaskDetailsJson(task) {
  return JSON.stringify({ version: 1, ...task }, null, 2);
}

export function formatTaskList(tasks) {
  if (!tasks.length) return 'No tasks.';
  return tasks.map(task => [
    task.id,
    task.status,
    task.title,
    ...formatInlineTaskMetadata(task, tasks)
  ].join(' | ')).join('\n');
}

export function formatTaskListJson(tasks) {
  return JSON.stringify({ version: 1, tasks }, null, 2);
}

async function readLedger(cwd) {
  const file = path.join(cwd, taskFile);
  const text = await fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  if (!text) return { version: 1, tasks: [] };
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    throw new CodeParkError('ERROR', `${taskFile} is not a valid CodePark task ledger`);
  }
  return {
    version: 1,
    tasks: parsed.tasks.map(normalizeTask)
  };
}

async function writeLedger(cwd, ledger) {
  const file = path.join(cwd, taskFile);
  await writeJsonAtomic(file, ledger);
}

function normalizeTask(task) {
  const id = String(task.id ?? '').trim();
  if (!id) throw new CodeParkError('EARGS', 'task id is required');
  const title = String(task.title ?? '').trim();
  if (!title) throw new CodeParkError('EARGS', 'task title is required');
  return {
    id,
    title,
    status: normalizeStatus(task.status),
    priority: normalizePriority(task.priority),
    dependsOn: normalizeIdList(task.dependsOn),
    labels: normalizeStringList(task.labels),
    ...(normalizeOptionalText(task.notes ?? task.note, 'task notes') ? { notes: normalizeOptionalText(task.notes ?? task.note, 'task notes') } : {}),
    createdAt: String(task.createdAt ?? ''),
    updatedAt: String(task.updatedAt ?? ''),
    ...(task.completedAt ? { completedAt: String(task.completedAt) } : {})
  };
}

function resolveTask(tasks, id) {
  const needle = String(id ?? '').trim();
  if (!needle) throw new CodeParkError('EARGS', 'task id is required');
  const exact = tasks.find(task => task.id === needle);
  if (exact) return exact;
  const matches = tasks.filter(task => task.id.startsWith(needle));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new CodeParkError('EARGS', `task id prefix is ambiguous: ${needle}`);
  throw new CodeParkError('EARGS', `task not found: ${needle}`);
}

function normalizeStatus(value, options = {}) {
  const status = String(value ?? '').trim().toLowerCase();
  if (!status && options.allowEmpty) return '';
  if (status === 'open' || status === 'done' || (status === 'blocked' && options.allowEmpty)) return status;
  throw new CodeParkError(
    'EARGS',
    options.allowEmpty ? 'task status must be open, done, or blocked' : 'task status must be open or done'
  );
}

function normalizePriority(value, options = {}) {
  const priority = String(value ?? '').trim().toLowerCase();
  if (!priority && options.allowEmpty) return '';
  if (!priority) return 'normal';
  if (priority === 'low' || priority === 'normal' || priority === 'high') return priority;
  throw new CodeParkError('EARGS', 'task priority must be low, normal, or high');
}

function normalizeIdList(value) {
  return normalizeStringList(value);
}

function normalizeStringList(value) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value)
    ? value
    : String(value).split(/[,\s]+/);
  return [...new Set(values
    .map(item => String(item ?? '').trim())
    .filter(Boolean))];
}

function normalizeOptionalText(value, label) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (text.includes('\0')) throw new CodeParkError('EARGS', `${label} contains an invalid null byte`);
  return text;
}

function resolveTaskReferences(tasks, value, options = {}) {
  return normalizeIdList(value).map(reference => {
    const task = resolveTask(tasks, reference);
    if (options.excludeId && task.id === options.excludeId) {
      throw new CodeParkError('EARGS', 'task cannot depend on itself');
    }
    return task.id;
  });
}

function blockedBy(task, allTasks) {
  return task.dependsOn.filter(id => {
    const dependency = allTasks.find(candidate => candidate.id === id);
    return !dependency || dependency.status !== 'done';
  });
}

function formatTaskMetadataLines(task) {
  return [
    task.priority && task.priority !== 'normal' ? `priority: ${task.priority}` : '',
    task.dependsOn?.length ? `dependsOn: ${task.dependsOn.join(',')}` : '',
    task.labels?.length ? `labels: ${task.labels.join(',')}` : '',
    task.notes ? `notes: ${task.notes}` : ''
  ].filter(Boolean);
}

function formatInlineTaskMetadata(task) {
  const metadata = [];
  if (task.priority && task.priority !== 'normal') metadata.push(`priority:${task.priority}`);
  if (task.dependsOn?.length) metadata.push(`depends-on:${task.dependsOn.join(',')}`);
  const blockers = task.blockedBy ?? [];
  if (blockers.length) metadata.push(`blocked-by:${blockers.join(',')}`);
  if (task.labels?.length) metadata.push(`labels:${task.labels.join(',')}`);
  return metadata;
}

function createTaskId(now, count) {
  const stamp = String(now).replace(/\D/g, '').slice(0, 14) || Date.now();
  return `task-${stamp}-${String(count).padStart(3, '0')}`;
}
