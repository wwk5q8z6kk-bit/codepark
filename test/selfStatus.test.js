import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSelfStatus } from '../src/selfStatus.js';

test('createSelfStatus describes the local CodePark surface', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-self-status-'));
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'codepark', version: '0.1.0' }));
  await fs.writeFile(path.join(dir, 'src', 'cli.js'), '');

  const report = await createSelfStatus({
    cwd: dir,
    config: { provider: 'codex', baseUrl: 'codex://cli' }
  });

  assert.match(report, /CodePark is this CLI/);
  assert.match(report, /codepark@0\.1\.0/);
  assert.match(report, /cli\.js/);
  assert.match(report, /first-run onboarding/);
  assert.match(report, /guarded file\/shell\/session\/patch\/quality-gate\/checkpoint\/task\/worker\/hook tools/);
  assert.match(report, /doctor diagnostics/);
  assert.match(report, /code intelligence/);
  assert.match(report, /local skills/);
  assert.match(report, /project rules/);
  assert.match(report, /verify it, commit it, and relaunch it/);
});
