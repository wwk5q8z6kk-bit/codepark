import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installLocal, formatLocalInstall } from '../src/localInstall.js';

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
  assert.match(await fs.readlink(path.join(binDir, 'codepark')), /bin\/codepark\.js$/);
  assert.match(await fs.readFile(path.join(root, '.codepark', 'profile.json'), 'utf8'), /"preferred":/);
  assert.match(await fs.readFile(path.join(root, '.codepark', 'hooks.json'), 'utf8'), /npm run verify/);
  assert.match(await fs.readFile(path.join(root, 'CodePark.command'), 'utf8'), /command -v codepark/);
  assert.match(await fs.readFile(path.join(root, 'CodePark.command'), 'utf8'), /'workspace-boot'/);
});

test('installLocal rejects existing command files unless force is set', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-local-install-skip-'));
  const binDir = path.join(root, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, 'codepark'), 'existing\n');
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({ scripts: { verify: 'node --version' } }, null, 2)}\n`);

  await assert.rejects(
    () => installLocal(root, { binDir }),
    /already exists/
  );

  const forced = await installLocal(root, { binDir, force: true });
  assert.equal(forced.command.ok, true);
  assert.equal(forced.command.action, 'rewrote');
  assert.match(await fs.readlink(path.join(binDir, 'codepark')), /bin\/codepark\.js$/);
});
