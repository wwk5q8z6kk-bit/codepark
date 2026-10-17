import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installLocal, formatLocalInstall } from '../src/localInstall.js';
import { defaultLauncherName } from '../src/launcher.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('installLocal installs command, profile, hooks, and launcher', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-local-install-'));
  const binDir = path.join(root, 'bin');
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    scripts: {
      verify: 'node --version'
    }
  }, null, 2)}\n`);

  const result = await installLocal(root, { binDir });
  const formatted = formatLocalInstall(result);

  assert.equal(result.command.ok, true);
  assert.equal(result.command.action, 'wrote');
  assert.equal(result.profile.ok, true);
  assert.equal(result.harness.ok, true);
  assert.equal(result.launcher.ok, true);
  assert.match(formatted, /CodePark local install/);
  if (process.platform === 'win32') {
    assert.match(await fs.readFile(path.join(binDir, 'codepark.cmd'), 'utf8'), /bin\\codepark\.js/);
  } else {
    assert.match(await fs.readlink(path.join(binDir, 'codepark')), /bin\/codepark\.js$/);
  }
  assert.match(await fs.readFile(path.join(root, '.codepark', 'profile.json'), 'utf8'), /"preferred":/);
  assert.match(await fs.readFile(path.join(root, '.codepark', 'hooks.json'), 'utf8'), /npm run verify/);
  const launcher = await fs.readFile(path.join(root, defaultLauncherName()), 'utf8');
  assert.match(launcher, process.platform === 'win32' ? /where codepark/ : /command -v codepark/);
  assert.match(launcher, /workspace-boot/);
});

test('installLocal rejects existing command files unless force is set', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-local-install-skip-'));
  const binDir = path.join(root, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, process.platform === 'win32' ? 'codepark.cmd' : 'codepark'), 'existing\n');
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({ scripts: { verify: 'node --version' } }, null, 2)}\n`);

  await assert.rejects(
    () => installLocal(root, { binDir }),
    /already exists/
  );

  const forced = await installLocal(root, { binDir, force: true });
  assert.equal(forced.command.ok, true);
  assert.equal(forced.command.action, 'rewrote');
  if (process.platform === 'win32') {
    assert.match(await fs.readFile(path.join(binDir, 'codepark.cmd'), 'utf8'), /bin\\codepark\.js/);
  } else {
    assert.match(await fs.readlink(path.join(binDir, 'codepark')), /bin\/codepark\.js$/);
  }
});

test('Windows command wrappers escape literal percent signs in executable paths', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-local-install-percent-'));
  const binDir = path.join(root, 'bin');
  const originalExecPath = process.execPath;
  Object.defineProperty(process, 'execPath', {
    value: `${originalExecPath}-%RUNTIME%`,
    configurable: true
  });

  try {
    await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({ scripts: { verify: 'node --version' } }, null, 2)}\n`);
    await installLocal(root, { binDir });
    const wrapper = await fs.readFile(path.join(binDir, 'codepark.cmd'), 'utf8');
    assert.match(wrapper, /%%RUNTIME%%/);
  } finally {
    Object.defineProperty(process, 'execPath', {
      value: originalExecPath,
      configurable: true
    });
  }
});

test('Windows command wrappers remain idempotent from percent-bearing install paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-local-install-idempotent-'));
  const aliasRoot = path.join(root, 'codepark-%PROJECT%');
  const workspace = path.join(root, 'workspace');
  const binDir = path.join(root, 'bin');
  await fs.mkdir(path.join(aliasRoot, 'bin'), { recursive: true });
  await fs.symlink(path.join(repoRoot, 'src'), path.join(aliasRoot, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.copyFile(path.join(repoRoot, 'bin', 'codepark.js'), path.join(aliasRoot, 'bin', 'codepark.js'));
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'package.json'), `${JSON.stringify({ scripts: { verify: 'node --version' } }, null, 2)}\n`);

  const script = [
    "Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });",
    `const { installLocal } = await import(${JSON.stringify(pathToFileURL(path.join(aliasRoot, 'src', 'localInstall.js')).href)});`,
    `const first = await installLocal(${JSON.stringify(workspace)}, { binDir: ${JSON.stringify(binDir)} });`,
    `const second = await installLocal(${JSON.stringify(workspace)}, { binDir: ${JSON.stringify(binDir)} });`,
    `const wrapper = await (await import('node:fs/promises')).readFile(${JSON.stringify(path.join(binDir, 'codepark.cmd'))}, 'utf8');`,
    'process.stdout.write(JSON.stringify({ first: first.command.action, second: second.command.action, wrapper }));'
  ].join('\n');
  const result = spawnSync(process.execPath, ['--preserve-symlinks', '--input-type=module', '--eval', script], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.first, 'wrote');
  assert.equal(output.second, 'unchanged');
  assert.match(output.wrapper, /codepark-%%PROJECT%%/);
});
