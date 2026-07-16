import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from '../src/checkpoint.js';

test('createCheckpoint stores git diff metadata and untracked files', async () => {
  const root = await createGitWorkspace();
  await fs.writeFile(path.join(root, 'tracked.txt'), 'changed\n');
  await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  await fs.writeFile(path.join(root, 'notes', 'new.txt'), 'untracked\n');

  const checkpoint = await createCheckpoint(root, { name: 'core done' });

  assert.equal(checkpoint.name, 'core done');
  assert.match(checkpoint.id, /core-done/);
  assert.deepEqual(checkpoint.untrackedFiles, ['notes/new.txt']);

  const patch = await fs.readFile(path.join(root, checkpoint.patchFile), 'utf8');
  assert.match(patch, /\+changed/);

  const copied = await fs.readFile(path.join(root, checkpoint.untrackedDir, 'notes', 'new.txt'), 'utf8');
  assert.equal(copied, 'untracked\n');
});

test('listCheckpoints returns checkpoint metadata newest first', async () => {
  const root = await createGitWorkspace();
  await createCheckpoint(root, { name: 'first' });
  await createCheckpoint(root, { name: 'second' });

  const checkpoints = await listCheckpoints(root);

  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].name, 'second');
  assert.equal(checkpoints[1].name, 'first');
  assert.deepEqual(checkpoints[0].untrackedFiles, []);
});

test('restoreCheckpoint reapplies tracked patch and restores untracked files', async () => {
  const root = await createGitWorkspace();
  await fs.writeFile(path.join(root, 'tracked.txt'), 'changed\n');
  await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  await fs.writeFile(path.join(root, 'notes', 'new.txt'), 'untracked\n');
  const checkpoint = await createCheckpoint(root, { name: 'restore me' });

  await fs.writeFile(path.join(root, 'tracked.txt'), 'initial\n');
  await fs.rm(path.join(root, 'notes'), { recursive: true, force: true });

  const restored = await restoreCheckpoint(root, checkpoint.id);

  assert.equal(restored.checkpoint.name, 'restore me');
  assert.equal(restored.appliedPatch, true);
  assert.deepEqual(restored.restoredUntrackedFiles, ['notes/new.txt']);
  assert.equal(await fs.readFile(path.join(root, 'tracked.txt'), 'utf8'), 'changed\n');
  assert.equal(await fs.readFile(path.join(root, 'notes', 'new.txt'), 'utf8'), 'untracked\n');
});

async function createGitWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-checkpoint-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'codepark@example.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'CodePark Test'], { cwd: root });
  await fs.writeFile(path.join(root, 'tracked.txt'), 'initial\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' });
  return root;
}
