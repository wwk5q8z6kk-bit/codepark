import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codeparkBin = path.join(repoRoot, 'bin', 'codepark.js');

function runCodePark(args, { cwd, env, input } = {}) {
  const result = spawnSync(
    process.execPath,
    [codeparkBin, '--cwd', cwd, ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
      input
    }
  );
  if (result.error) throw result.error;
  return result;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: expected JSON but got:\n${text}`);
  }
}

function extractJsonBlocks(text) {
  return [...String(text).matchAll(/\{\n[\s\S]*?\n\}/g)].map(match => match[0]);
}

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-smoke-json-'));
  const interactiveWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-smoke-json-interactive-'));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-smoke-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-smoke-sessions-'));
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: configDir,
    CODEPARK_SESSION_DIR: sessionDir
  };

  // Top-level CLI JSON mutations.
  const added = runCodePark(['task-add', '--json', 'Smoke task JSON'], { cwd: workspace, env });
  assert.equal(added.status, 0, added.stderr);
  const addedJson = parseJson(added.stdout, 'task-add --json');
  assert.equal(addedJson.version, 1);
  assert.equal(addedJson.status, 'open');
  assert.equal(addedJson.title, 'Smoke task JSON');
  assert.ok(addedJson.id);

  const updated = runCodePark(
    ['task-update', '--json', addedJson.id, '--priority', 'high', '--label', 'smoke'],
    { cwd: workspace, env }
  );
  assert.equal(updated.status, 0, updated.stderr);
  const updatedJson = parseJson(updated.stdout, 'task-update --json');
  assert.equal(updatedJson.version, 1);
  assert.equal(updatedJson.id, addedJson.id);
  assert.equal(updatedJson.priority, 'high');
  assert.deepEqual(updatedJson.labels, ['smoke']);

  const done = runCodePark(['task-done', '--json', addedJson.id], { cwd: workspace, env });
  assert.equal(done.status, 0, done.stderr);
  const doneJson = parseJson(done.stdout, 'task-done --json');
  assert.equal(doneJson.version, 1);
  assert.equal(doneJson.id, addedJson.id);
  assert.equal(doneJson.status, 'done');

  const reopened = runCodePark(['task-open', '--json', addedJson.id], { cwd: workspace, env });
  assert.equal(reopened.status, 0, reopened.stderr);
  const reopenedJson = parseJson(reopened.stdout, 'task-open --json');
  assert.equal(reopenedJson.version, 1);
  assert.equal(reopenedJson.id, addedJson.id);
  assert.equal(reopenedJson.status, 'open');

  // Interactive slash JSON flow (ensures /task-* --json prints parseable JSON).
  const interactive = spawnSync(
    process.execPath,
    [codeparkBin, '--cwd', interactiveWorkspace, '--yes'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
      input: [
        '/task-add --priority high --label docs --notes \"slash json\" Add slash json',
        '/task-update task- --priority low --label docs --notes \"slash json updated\" --json',
        '/task-show --json task-',
        '/tasks open --json',
        '/exit',
        ''
      ].join('\n')
    }
  );
  if (interactive.error) throw interactive.error;
  assert.equal(interactive.status, 0, interactive.stderr);

  const blocks = extractJsonBlocks(interactive.stdout);
  assert.ok(blocks.length >= 2, `expected >=2 JSON blocks, got ${blocks.length}\n${interactive.stdout}`);
  const parsed = blocks.map((block, idx) => parseJson(block, `interactive json block ${idx + 1}`));
  assert.ok(
    parsed.some(obj => obj.version === 1 && obj.title === 'Add slash json' && obj.priority === 'low'),
    'missing updated task JSON in interactive output'
  );
  assert.ok(
    parsed.some(obj => obj.version === 1 && obj.title === 'Add slash json' && obj.notes === 'slash json updated'),
    'missing updated task notes in interactive output'
  );
  assert.ok(
    parsed.some(obj => obj.version === 1 && Array.isArray(obj.tasks) && obj.tasks.length === 1),
    'missing task list JSON in interactive output'
  );

  console.log('smoke ok: task mutation json (top-level + slash)');
}

await main().catch(error => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
