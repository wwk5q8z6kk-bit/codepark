import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatLauncherInstall, installLauncher } from '../src/launcher.js';

test('installLauncher writes an executable workspace launcher', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-launcher-'));

  const result = await installLauncher(root);
  assert.equal(result.path, 'CodePark.command');
  assert.equal(result.overwritten, false);
  assert.match(formatLauncherInstall(result), /Wrote CodePark\.command/);

  const target = path.join(root, 'CodePark.command');
  const text = await fs.readFile(target, 'utf8');
  const mode = (await fs.stat(target)).mode & 0o777;
  assert.match(text, /CodePark workspace boot/);
  assert.match(text, /Workspace:/);
  assert.match(text, /command -v codepark/);
  assert.match(text, /codepark' '--secure' '--cwd'/);
  assert.match(text, /'workspace-boot'/);
  assert.doesNotMatch(text, /then exec 'codepark'/);
  assert.match(text, /Next commands: codepark workers \| codepark dashboard-open \| codepark doctor/);
  assert.match(text, /Press Return to close this CodePark window\.|Press Enter to close this CodePark window\./);
  assert.match(text, /bin\/codepark\.js/);
  assert.equal(mode, 0o755);

  await assert.rejects(
    () => installLauncher(root),
    /CodePark\.command already exists/
  );
});

test('installLauncher supports forced relative targets only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-launcher-force-'));
  await fs.writeFile(path.join(root, 'Start.command'), 'old\n');

  const result = await installLauncher(root, { target: 'Start.command', force: true });
  assert.equal(result.path, 'Start.command');
  assert.equal(result.overwritten, true);
  assert.match(await fs.readFile(path.join(root, 'Start.command'), 'utf8'), /'workspace-boot'/);

  await assert.rejects(
    () => installLauncher(root, { target: '../outside.command' }),
    /must stay inside/
  );
});
