import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCodeParkShellCommand, defaultLauncherName, formatLauncherInstall, installLauncher } from '../src/launcher.js';

test('installLauncher writes an executable workspace launcher', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-launcher-'));
  const launcherName = defaultLauncherName();

  const result = await installLauncher(root);
  assert.equal(result.path, launcherName);
  assert.equal(result.overwritten, false);
  assert.match(formatLauncherInstall(result), new RegExp(`Wrote ${launcherName.replace('.', '\\.')}`));

  const target = path.join(root, launcherName);
  const text = await fs.readFile(target, 'utf8');
  assert.match(text, /CodePark workspace boot/);
  assert.match(text, /Workspace:/);
  assert.match(text, process.platform === 'win32' ? /where codepark/ : /command -v codepark/);
  if (process.platform === 'win32') {
    assert.match(text, /if \/I not "%%~fI"=="%~f0"/);
  }
  assert.match(text, /--secure/);
  assert.match(text, /workspace-boot/);
  assert.doesNotMatch(text, /then exec 'codepark'/);
  assert.match(text, /Next commands: codepark workers.*codepark dashboard-open.*codepark doctor/);
  assert.match(text, /Press Return to close this CodePark window\.|Press Enter to close this CodePark window\.|Press any key to close this CodePark window\./);
  assert.match(text, process.platform === 'win32' ? /bin\\codepark\.js/ : /bin\/codepark\.js/);
  if (process.platform !== 'win32') {
    const mode = (await fs.stat(target)).mode & 0o777;
    assert.equal(mode, 0o755);
  }

  await assert.rejects(
    () => installLauncher(root),
    new RegExp(`${launcherName.replace('.', '\\.')} already exists`)
  );
});

test('installLauncher supports forced relative targets only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-launcher-force-'));
  const target = process.platform === 'win32' ? 'Start.cmd' : 'Start.command';
  await fs.writeFile(path.join(root, target), 'old\n');

  const result = await installLauncher(root, { target, force: true });
  assert.equal(result.path, target);
  assert.equal(result.overwritten, true);
  assert.match(await fs.readFile(path.join(root, target), 'utf8'), /workspace-boot/);

  await assert.rejects(
    () => installLauncher(root, { target: '../outside.command' }),
    /must stay inside/
  );
});

test('Windows launchers require cmd targets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-launcher-extension-'));
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    await assert.rejects(
      () => installLauncher(root, { target: 'Start.command' }),
      /must use the \.cmd extension/
    );
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

test('Windows launchers escape literal percent signs in workspace paths', { skip: process.platform !== 'win32' }, async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-launcher-percent-'));
  const root = path.join(parent, 'workspace-%PROJECT%');
  await fs.mkdir(root);

  await installLauncher(root);

  const text = await fs.readFile(path.join(root, defaultLauncherName()), 'utf8');
  assert.match(text, /workspace-%%PROJECT%%/);
});

test('Windows launchers ignore themselves when finding a global command', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    const command = buildCodeParkShellCommand('C:\\workspace-%PROJECT%', ['--secure', '--cwd', 'C:\\workspace-%PROJECT%', 'workspace-boot']);
    assert.match(command, /where codepark/);
    assert.match(command, /if \/I not "%%~fI"=="%~f0"/);
    assert.match(command, /call "%codeparkCommand%"/);
    assert.match(command, /workspace-%%PROJECT%%/);
    assert.match(command, /call "%codeparkCommand%" "--secure" "--cwd" "C:\\workspace-%%%%PROJECT%%%%" "workspace-boot"/);
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});
