import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootWorkspace, formatWorkspaceBoot } from '../src/workspaceBoot.js';
import { defaultLauncherName } from '../src/launcher.js';
import { readWorker } from '../src/workers.js';

const codexConfig = {
  provider: 'codex',
  baseUrl: 'codex://cli',
  model: 'codex-cli-default',
  localOnly: true,
  secureMode: true
};

test('bootWorkspace initializes missing harness files and writes dashboard without starting app', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-boot-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'boot-app',
    scripts: {
      dev: 'node server.js',
      check: 'node --check server.js',
      test: 'node --test'
    }
  }));
  await fs.writeFile(path.join(root, 'README.md'), '# Boot app\n');

  const result = await bootWorkspace(root, codexConfig, { start: false });

  assert.equal(result.ready, true);
  assert.equal(result.app, null);
  assert.deepEqual(result.steps.map(step => [step.name, step.action]), [
    ['profile', 'wrote'],
    ['harness', 'wrote'],
    ['launcher', 'wrote'],
    ['app', 'skipped'],
    ['dashboard', 'wrote']
  ]);
  assert.match(formatWorkspaceBoot(result), /Workspace boot/);
  assert.match(formatWorkspaceBoot(result), /ready: yes/);
  await fs.stat(path.join(root, '.codepark', 'profile.json'));
  await fs.stat(path.join(root, '.codepark', 'hooks.json'));
  await fs.stat(path.join(root, defaultLauncherName()));
  await fs.stat(path.join(root, '.codepark', 'dashboard.html'));
});

test('bootWorkspace can start the detected app as a managed worker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-boot-start-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'boot-start-app',
    scripts: {
      dev: 'node -e "console.log(\\"booted app\\")"',
      verify: 'node --version'
    }
  }));
  await fs.writeFile(path.join(root, 'README.md'), '# Boot start app\n');

  const result = await bootWorkspace(root, codexConfig, { id: 'boot-start-app' });

  assert.equal(result.app.worker.id, 'boot-start-app');
  assert.equal(result.steps.find(step => step.name === 'app')?.action, 'started');
  await waitForWorkerOutput(root, 'boot-start-app', /booted app/);
});

test('bootWorkspace rewrites stale launchers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-boot-stale-launcher-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'boot-stale-launcher-app',
    scripts: {
      dev: 'node server.js',
      verify: 'node --version'
    }
  }));
  await fs.writeFile(path.join(root, 'README.md'), '# Boot stale launcher app\n');
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), JSON.stringify({
    hooks: {
      verify: ['npm run verify']
    }
  }));
  await fs.writeFile(path.join(root, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: ['npm run verify']
    }
  }));
  await fs.writeFile(path.join(root, defaultLauncherName()), [
    '#!/bin/sh',
    'set -eu',
    "cd . && if command -v codepark >/dev/null 2>&1; then exec codepark --secure; else exec node ./bin/codepark.js --secure; fi",
    ''
  ].join('\n'), { mode: 0o755 });

  const result = await bootWorkspace(root, codexConfig, { start: false });

  assert.equal(result.steps.find(step => step.name === 'launcher')?.action, 'rewrote');
  assert.equal(result.ready, true);
  const launcher = await fs.readFile(path.join(root, defaultLauncherName()), 'utf8');
  assert.match(launcher, /workspace-boot/);
  assert.match(launcher, /Press Return to close this CodePark window\.|Press Enter to close this CodePark window\.|Press any key to close this CodePark window\./);
});

async function waitForWorkerOutput(root, id, pattern) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const read = await readWorker(root, id).catch(() => null);
    if (read?.output && pattern.test(read.output)) return read;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${id}`);
}
