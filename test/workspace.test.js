import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveWorkspacePath, summarizeDirectory } from '../src/workspace.js';

test('resolveWorkspacePath blocks parent traversal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-'));
  await assert.rejects(
    () => resolveWorkspacePath(root, '../outside.txt'),
    /escapes workspace/
  );
});

test('resolveWorkspacePath blocks symlink escapes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-outside-'));
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'secret-link.txt'));
  await fs.symlink(outside, path.join(root, 'outside-dir'));

  await assert.rejects(
    () => resolveWorkspacePath(root, 'secret-link.txt', { mustExist: true, file: true }),
    /escapes workspace/
  );
  await assert.rejects(
    () => resolveWorkspacePath(root, 'outside-dir/new.txt'),
    /escapes workspace/
  );
});

test('summarizeDirectory ignores node_modules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-'));
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'README.md'), 'ok');
  const output = await summarizeDirectory(root, {
    root,
    maxDepth: 2,
    ignore: new Set(['node_modules'])
  });
  assert.match(output, /README\.md/);
  assert.doesNotMatch(output, /node_modules/);
});
