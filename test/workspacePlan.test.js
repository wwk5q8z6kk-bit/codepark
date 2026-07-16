import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspacePlan, formatWorkspacePlan } from '../src/workspacePlan.js';

test('createWorkspacePlan inspects app launch, hooks, profile, launcher, and next actions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-plan-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'planned-app',
    version: '1.2.3',
    scripts: {
      dev: 'vite --host 127.0.0.1',
      check: 'eslint .',
      test: 'node --test',
      build: 'vite build'
    },
    dependencies: {
      '@vitejs/plugin-react': 'latest',
      react: 'latest'
    }
  }));
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  await fs.writeFile(path.join(root, 'compose.yaml'), 'services:\n  app:\n    image: node:alpine\n');
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: ['pnpm run check', 'pnpm run test']
    }
  }));

  const plan = await createWorkspacePlan(root);

  assert.equal(plan.package.name, 'planned-app');
  assert.equal(plan.package.packageManager, 'pnpm');
  assert.deepEqual(plan.launch, {
    source: 'package',
    script: 'dev',
    command: 'pnpm run dev',
    packageManager: 'pnpm',
    message: 'package script dev'
  });
  assert.equal(plan.hooks.configured, true);
  assert.equal(plan.profile.configured, false);
  assert.equal(plan.launcher.configured, false);
  assert.deepEqual(plan.missing, ['profile-init', 'launcher-install']);
  assert.equal(plan.ready, false);
  assert.ok(plan.appTypes.includes('node'));
  assert.ok(plan.appTypes.includes('react'));
  assert.ok(plan.appTypes.includes('vite'));
  assert.ok(plan.appTypes.includes('compose'));

  const formatted = formatWorkspacePlan(plan);
  assert.match(formatted, /Workspace plan/);
  assert.match(formatted, /launch: pnpm run dev \(package\)/);
  assert.match(formatted, /missing: profile-init, launcher-install/);
  assert.match(formatted, /codepark dashboard-open/);
});

test('createWorkspacePlan reports missing launch commands', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-plan-missing-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node --test'
    }
  }));

  const plan = await createWorkspacePlan(root);

  assert.equal(plan.launch.command, '');
  assert.ok(plan.missing.includes('app-launch-command'));
  assert.match(formatWorkspacePlan(plan), /No app launch command found/);
});

test('createWorkspacePlan includes app types from non-Node launch detection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-plan-php-'));
  await fs.mkdir(path.join(root, 'public'));
  await fs.writeFile(path.join(root, 'public', 'index.php'), '<?php echo "ok";\n');

  const plan = await createWorkspacePlan(root);

  assert.ok(plan.appTypes.includes('php'));
  assert.equal(plan.launch.command, 'php -S 127.0.0.1:8000 -t public');
  assert.ok(plan.missing.includes('profile-init'));
  assert.ok(plan.missing.includes('launcher-install'));
});

test('createWorkspacePlan marks stale launchers as needing update', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-plan-stale-launcher-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'vite',
      verify: 'node --version'
    }
  }));
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
  await fs.writeFile(path.join(root, 'CodePark.command'), [
    '#!/bin/sh',
    'set -eu',
    "cd . && if command -v codepark >/dev/null 2>&1; then exec codepark --secure; else exec node ./bin/codepark.js --secure; fi",
    ''
  ].join('\n'), { mode: 0o755 });

  const plan = await createWorkspacePlan(root);

  assert.equal(plan.launcher.configured, true);
  assert.equal(plan.launcher.ready, false);
  assert.ok(plan.missing.includes('launcher-install'));
  assert.equal(plan.ready, false);
  assert.match(formatWorkspacePlan(plan), /launcher: needs update/);
});
