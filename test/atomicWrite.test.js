import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonAtomic, writeTextAtomic } from '../src/atomicWrite.js';

test('writeTextAtomic writes content through a temp file and leaves no temp artifacts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-atomic-'));
  const file = path.join(root, 'state', 'ledger.txt');

  await writeTextAtomic(file, 'first\n', { mode: 0o600 });
  await writeTextAtomic(file, 'second\n', { mode: 0o600 });

  assert.equal(await fs.readFile(file, 'utf8'), 'second\n');
  if (process.platform !== 'win32') {
    const stat = await fs.stat(file);
    assert.equal(stat.mode & 0o777, 0o600);
  }
  const leftovers = await fs.readdir(path.dirname(file));
  assert.deepEqual(leftovers, ['ledger.txt']);
});

test('writeJsonAtomic formats json deterministically', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-atomic-'));
  const file = path.join(root, 'ledger.json');

  await writeJsonAtomic(file, { version: 1, items: ['a'] });

  assert.equal(await fs.readFile(file, 'utf8'), '{\n  "version": 1,\n  "items": [\n    "a"\n  ]\n}\n');
});
