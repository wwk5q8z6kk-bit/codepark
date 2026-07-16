import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isGitRepo, gitSummary } from '../src/git.js';

test('isGitRepo returns false outside git repo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-git-'));
  assert.equal(await isGitRepo(root), false);
});

test('gitSummary reports not a git repo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-git-'));
  const result = await gitSummary(root);
  assert.equal(result.isRepo, false);
});
