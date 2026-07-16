import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyWorkspacePolicyPreset,
  assertWorkspacePatchAllowed,
  assertWorkspaceWriteAllowed,
  evaluateWorkspaceCommandPolicy,
  extractPatchPaths,
  listWorkspacePolicyPresets,
  readWorkspacePolicy
} from '../src/workspacePolicy.js';

test('readWorkspacePolicy uses secure defaults without a profile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-policy-'));
  const policy = await readWorkspacePolicy(root);

  assert.deepEqual(policy.write.deny, ['.git/**', 'node_modules/**']);
  assert.deepEqual(policy.commands.denyCommands, ['sudo']);
});

test('workspace policy presets can be applied to profiles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-policy-preset-'));
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    scripts: { verify: 'node --test' }
  }, null, 2)}\n`);

  assert.deepEqual(listWorkspacePolicyPresets(), [
    'default',
    'docs-only',
    'java-app',
    'node-app',
    'php-app',
    'python-app',
    'ruby-app',
    'strict'
  ]);

  const applied = await applyWorkspacePolicyPreset(root, 'node-app');
  assert.equal(applied.created, true);
  assert.equal(applied.preset, 'node-app');
  assert.deepEqual(applied.policy.commands.denyCommands, ['sudo']);
  assert.match(JSON.stringify(applied.policy.write.allow), /package\.json/);

  await assert.rejects(
    () => applyWorkspacePolicyPreset(root, 'docs-only'),
    /already exists/
  );

  const forced = await applyWorkspacePolicyPreset(root, 'docs-only', { force: true });
  assert.equal(forced.created, false);
  assert.deepEqual(forced.policy.commands.denyCommands, ['sudo', 'node', 'npm', 'python', 'python3', 'pip', 'pip3', 'docker', 'podman', 'git']);
});

test('workspace write policy blocks denied paths and honors allow lists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-policy-write-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      write: {
        allow: ['src/**'],
        deny: ['src/generated/**']
      }
    }
  }, null, 2)}\n`);

  await assert.doesNotReject(() => assertWorkspaceWriteAllowed(root, path.join(root, 'src', 'index.js')));
  await assert.rejects(
    () => assertWorkspaceWriteAllowed(root, path.join(root, 'README.md')),
    /blocked by workspace write policy/
  );
  await assert.rejects(
    () => assertWorkspaceWriteAllowed(root, path.join(root, 'src', 'generated', 'file.js')),
    /blocked by workspace write policy/
  );
});

test('workspace command policy blocks profile commands and patterns', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-policy-command-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      commands: {
        denyCommands: ['python'],
        denyPatterns: ['--production']
      }
    }
  }, null, 2)}\n`);

  assert.equal(await evaluateWorkspaceCommandPolicy(root, 'node --version'), 'allowedWithPermission');
  assert.equal(await evaluateWorkspaceCommandPolicy(root, 'python script.py'), 'disabled');
  assert.equal(await evaluateWorkspaceCommandPolicy(root, 'npm run deploy -- --production'), 'disabled');
});

test('workspace patch policy extracts and checks modified file paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-policy-patch-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      write: {
        allow: ['src/**'],
        deny: []
      }
    }
  }, null, 2)}\n`);
  const patch = [
    'diff --git a/src/app.js b/src/app.js',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    ''
  ].join('\n');
  const blockedPatch = patch.replaceAll('src/app.js', 'test/app.test.js');

  assert.deepEqual(extractPatchPaths(patch), ['src/app.js']);
  await assert.doesNotReject(() => assertWorkspacePatchAllowed(root, patch));
  await assert.rejects(
    () => assertWorkspacePatchAllowed(root, blockedPatch),
    /blocked by workspace write policy/
  );
});
