import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import * as http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = path.join(root, 'test', 'fixtures', 'json');
const execFileAsync = promisify(execFile);

function loadFixture(name) {
  return fs.readFile(path.join(fixturesDir, name), 'utf8').then(text => JSON.parse(text));
}

function runCodePark(workspace, args, env) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, ...args],
    { cwd: root, encoding: 'utf8', env }
  );
}

async function runCodeParkAsync(workspace, args, env) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, ...args],
      { cwd: root, encoding: 'utf8', env, timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    return { status: 0, stdout, stderr };
  } catch (error) {
    return {
      status: typeof error?.code === 'number' ? error.code : 1,
      stdout: error?.stdout ?? '',
      stderr: error?.stderr ?? ''
    };
  }
}

function normalizeDashboard(json, workspace) {
  return {
    ...json,
    cwd: json.cwd === workspace ? '<cwd>' : json.cwd
  };
}

function normalizeDoctor(json, workspace) {
  return {
    ...json,
    node: { ...json.node, message: '<node>' },
    workspace: { ...json.workspace, message: '<cwd>' },
    command: { ...json.command, message: '<command>' }
  };
}

function normalizeTask(json) {
  const normalized = {
    ...json,
    id: '<id>'
  };

  for (const key of ['createdAt', 'updatedAt', 'completedAt']) {
    if (key in normalized) normalized[key] = '<timestamp>';
  }

  return normalized;
}

function normalizeWebFetch(json) {
  const headers = json.headers && typeof json.headers === 'object' ? json.headers : {};
  const normalizedHeaders = {};
  for (const key of ['content-length', 'content-type', 'date']) {
    if (headers[key] !== undefined) normalizedHeaders[key] = headers[key];
  }
  return {
    ...json,
    url: '<url>',
    headers: normalizedHeaders
  };
}

test('json fixtures: tasks empty list', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  const result = runCodePark(workspace, ['tasks', '--json'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), await loadFixture('tasks-empty.json'));
});

test('json fixtures: web fetch', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-web-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain');
    res.setHeader('date', 'Mon, 01 Jan 2000 00:00:00 GMT');
    res.end('fixture');
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  try {
    const result = await runCodeParkAsync(workspace, ['web', '--json', url], env);
    assert.equal(result.status, 0, result.stderr);
    const normalized = normalizeWebFetch(JSON.parse(result.stdout));
    assert.deepEqual(normalized, await loadFixture('web-fetch.json'));
  } finally {
    server.close();
  }
});

test('json fixtures: workers empty list', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  const result = runCodePark(workspace, ['workers', '--json'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), await loadFixture('workers-empty.json'));
});

test('json fixtures: dashboard empty', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  const result = runCodePark(workspace, ['dashboard', '--json'], env);
  assert.equal(result.status, 0, result.stderr);
  const normalized = normalizeDashboard(JSON.parse(result.stdout), workspace);
  assert.deepEqual(normalized, await loadFixture('dashboard-empty.json'));
});

test('json fixtures: doctor', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-bin-'));
  const configPath = path.join(configDir, 'config.json');
  await fs.chmod(configDir, 0o700);
  await fs.writeFile(configPath, `${JSON.stringify({ provider: 'codex' }, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(configPath, 0o600);
  await fs.symlink(path.join(root, 'bin', 'codepark.js'), path.join(binDir, 'codepark'));

  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    CODEPARK_CONFIG_DIR: configDir,
    CODEPARK_CONFIG_PATH: configPath
  };
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, '--provider', 'codex', 'doctor', '--json'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(result.status, 0, result.stderr);
  const normalized = normalizeDoctor(JSON.parse(result.stdout), workspace);
  assert.deepEqual(normalized, await loadFixture('doctor.json'));
});

test('json fixtures: error on bad tasks status (--json)', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  const result = runCodePark(workspace, ['tasks', 'nope', '--json'], env);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), await loadFixture('error-tasks-bad-status.json'));
});

test('json fixtures: error on unknown flag (--json)', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  const result = runCodePark(workspace, ['--json', '--wat', 'x', 'tasks'], env);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), await loadFixture('error-unknown-flag.json'));
});

test('json fixtures: error on task-show not found (--json)', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  const result = runCodePark(workspace, ['task-show', '--json', 'missing'], env);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), await loadFixture('error-task-not-found.json'));
});

test('json fixtures: error on task-show ambiguous prefix (--json)', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  runCodePark(workspace, ['task-add', 'Task one'], env);
  runCodePark(workspace, ['task-add', 'Task two'], env);
  const result = runCodePark(workspace, ['task-show', '--json', 'task-'], env);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), await loadFixture('error-task-ambiguous-prefix.json'));
});

test('json fixtures: error on worker-read not found (--json)', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  const result = runCodePark(workspace, ['worker-read', '--json', 'missing'], env);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), await loadFixture('error-worker-not-found.json'));
});

test('json fixtures: error on worker-read ambiguous prefix (--json)', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };
  await fs.mkdir(path.join(workspace, '.codepark', 'workers'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'workers.json'), `${JSON.stringify({
    version: 1,
    workers: [
      {
        id: 'worker-a',
        taskId: 'task-1',
        taskTitle: 'Task 1',
        kind: 'shell',
        command: 'echo a',
        cwd: workspace,
        status: 'done',
        pid: null,
        exitCode: 0,
        logPath: '.codepark/workers/worker-a.log',
        statusPath: '.codepark/workers/worker-a.status.json',
        createdAt: '2026-04-18T12:00:00.000Z',
        updatedAt: '2026-04-18T12:00:00.000Z',
        finishedAt: '2026-04-18T12:00:01.000Z'
      },
      {
        id: 'worker-b',
        taskId: 'task-2',
        taskTitle: 'Task 2',
        kind: 'shell',
        command: 'echo b',
        cwd: workspace,
        status: 'done',
        pid: null,
        exitCode: 0,
        logPath: '.codepark/workers/worker-b.log',
        statusPath: '.codepark/workers/worker-b.status.json',
        createdAt: '2026-04-18T12:00:00.000Z',
        updatedAt: '2026-04-18T12:00:00.000Z',
        finishedAt: '2026-04-18T12:00:01.000Z'
      }
    ]
  }, null, 2)}\n`);

  const result = runCodePark(workspace, ['worker-read', '--json', 'worker-'], env);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), await loadFixture('error-worker-ambiguous-prefix.json'));
});

test('json fixtures: task mutation JSON outputs + task-show', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-fixtures-task-'));
  const env = { ...process.env, CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')) };

  const added = runCodePark(
    workspace,
    ['task-add', '--json', '--priority', 'high', '--label', 'docs', '--notes', 'Fixture notes.', 'Write fixture tests'],
    env
  );
  assert.equal(added.status, 0, added.stderr);
  const addedJson = JSON.parse(added.stdout);
  const taskId = addedJson.id;
  assert.ok(taskId && taskId.startsWith('task-'));
  assert.deepEqual(normalizeTask(addedJson), await loadFixture('task-add.json'));

  const updated = runCodePark(
    workspace,
    ['task-update', '--json', taskId, '--priority', 'low', '--label', 'ops', '--notes', 'Updated notes.'],
    env
  );
  assert.equal(updated.status, 0, updated.stderr);
  assert.deepEqual(normalizeTask(JSON.parse(updated.stdout)), await loadFixture('task-update.json'));

  const done = runCodePark(workspace, ['task-done', '--json', taskId], env);
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(normalizeTask(JSON.parse(done.stdout)), await loadFixture('task-done.json'));

  const reopened = runCodePark(workspace, ['task-open', '--json', taskId], env);
  assert.equal(reopened.status, 0, reopened.stderr);
  assert.deepEqual(normalizeTask(JSON.parse(reopened.stdout)), await loadFixture('task-open.json'));

  const shown = runCodePark(workspace, ['task-show', '--json', taskId], env);
  assert.equal(shown.status, 0, shown.stderr);
  assert.deepEqual(normalizeTask(JSON.parse(shown.stdout)), await loadFixture('task-show.json'));
});
