import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addTask,
  completeTask,
  formatTaskDetails,
  formatTaskList,
  formatTaskUpdated,
  getTask,
  listTasks,
  reopenTask,
  updateTask
} from '../src/tasks.js';

test('task ledger adds and lists open tasks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tasks-'));

  const task = await addTask(root, { title: 'Add task ledger', now: '2026-04-18T12:00:00.000Z' });
  assert.equal(task.title, 'Add task ledger');
  assert.equal(task.status, 'open');
  assert.match(task.id, /^task-/);

  const tasks = await listTasks(root);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Add task ledger');

  const formatted = formatTaskList(tasks);
  assert.match(formatted, /open/);
  assert.match(formatted, /Add task ledger/);
});

test('task ledger completes tasks and filters by status', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tasks-'));

  const task = await addTask(root, { title: 'Close the loop', now: '2026-04-18T12:00:00.000Z' });
  const completed = await completeTask(root, task.id, { now: '2026-04-18T12:01:00.000Z' });

  assert.equal(completed.status, 'done');
  assert.equal(completed.completedAt, '2026-04-18T12:01:00.000Z');
  assert.equal((await listTasks(root, { status: 'open' })).length, 0);
  assert.equal((await listTasks(root, { status: 'done' })).length, 1);
});

test('task ledger tracks priority, labels, notes, and blocked dependencies', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tasks-'));

  const foundation = await addTask(root, {
    title: 'Build foundation',
    now: '2026-04-18T12:00:00.000Z'
  });
  const dependent = await addTask(root, {
    title: 'Build feature',
    priority: 'high',
    dependsOn: [foundation.id.slice(0, 12)],
    labels: ['agent', 'coordination'],
    notes: 'Needs foundation first.',
    now: '2026-04-18T12:01:00.000Z'
  });

  assert.equal(dependent.priority, 'high');
  assert.deepEqual(dependent.dependsOn, [foundation.id]);
  assert.deepEqual(dependent.labels, ['agent', 'coordination']);
  assert.equal(dependent.notes, 'Needs foundation first.');

  const blocked = await listTasks(root, { status: 'blocked' });
  assert.deepEqual(blocked.map(task => task.id), [dependent.id]);
  assert.match(formatTaskList(blocked), /priority:high/);
  assert.match(formatTaskList(blocked), new RegExp(`blocked-by:${foundation.id}`));
  assert.match(formatTaskList(blocked), /labels:agent,coordination/);

  await completeTask(root, foundation.id, { now: '2026-04-18T12:02:00.000Z' });
  assert.deepEqual(await listTasks(root, { status: 'blocked' }), []);
});

test('task ledger updates structured metadata without breaking existing fields', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tasks-'));

  const task = await addTask(root, {
    title: 'Initial title',
    now: '2026-04-18T12:00:00.000Z'
  });
  const updated = await updateTask(root, task.id, {
    title: 'Updated title',
    priority: 'low',
    labels: ['docs'],
    notes: 'Trimmed note.'
  }, {
    now: '2026-04-18T12:03:00.000Z'
  });

  assert.equal(updated.title, 'Updated title');
  assert.equal(updated.priority, 'low');
  assert.deepEqual(updated.labels, ['docs']);
  assert.equal(updated.notes, 'Trimmed note.');
  assert.equal(updated.status, 'open');
  assert.equal(updated.updatedAt, '2026-04-18T12:03:00.000Z');
  assert.match(formatTaskUpdated(updated), /priority: low/);
  assert.match(formatTaskList(await listTasks(root)), /Updated title \| priority:low \| labels:docs/);
});

test('task ledger returns detailed task metadata by id prefix', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tasks-'));

  const dependency = await addTask(root, {
    title: 'Dependency task',
    now: '2026-04-18T12:00:00.000Z'
  });
  const task = await addTask(root, {
    title: 'Detailed task',
    priority: 'high',
    dependsOn: [dependency.id],
    labels: ['detail'],
    notes: 'Detailed notes.',
    now: '2026-04-18T12:01:00.000Z'
  });

  const detailed = await getTask(root, task.id.slice(0, 18));
  assert.equal(detailed.id, task.id);
  assert.deepEqual(detailed.blockedBy, [dependency.id]);

  const formatted = formatTaskDetails(detailed);
  assert.match(formatted, /Task detail:/);
  assert.match(formatted, /priority: high/);
  assert.match(formatted, new RegExp(`dependsOn: ${dependency.id}`));
  assert.match(formatted, new RegExp(`blockedBy: ${dependency.id}`));
  assert.match(formatted, /labels: detail/);
  assert.match(formatted, /notes: Detailed notes\./);
});

test('task ledger reopens completed tasks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tasks-'));

  const task = await addTask(root, { title: 'Reopen when needed', now: '2026-04-18T12:00:00.000Z' });
  await completeTask(root, task.id, { now: '2026-04-18T12:01:00.000Z' });
  const reopened = await reopenTask(root, task.id, { now: '2026-04-18T12:02:00.000Z' });

  assert.equal(reopened.status, 'open');
  assert.equal(reopened.completedAt, undefined);
  assert.equal(reopened.updatedAt, '2026-04-18T12:02:00.000Z');
  assert.equal((await listTasks(root, { status: 'open' })).length, 1);
});

test('task ledger rejects entries without ids or titles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tasks-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'tasks.json'), JSON.stringify({
    tasks: [
      { id: '', title: 'Missing id', status: 'open' },
      { id: 'task-2', title: '', status: 'done' }
    ]
  }));

  await assert.rejects(
    () => listTasks(root),
    /task id is required/
  );
});
