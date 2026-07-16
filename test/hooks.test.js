import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  formatHookList,
  formatHookRun,
  listHooks,
  runHook
} from '../src/hooks.js';

test('hook config lists named project hooks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-hooks-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: ['node -e "console.log(\\"hook verify\\")"']
    }
  }));

  const hooks = await listHooks(root);
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].name, 'verify');

  const formatted = formatHookList(hooks);
  assert.match(formatted, /verify/);
  assert.match(formatted, /hook verify/);
});

test('runHook executes configured commands in order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-hooks-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: [
        'node -e "console.log(\\"first\\")"',
        'node -e "console.log(\\"second\\")"'
      ]
    }
  }));

  const result = await runHook(root, 'verify');
  assert.equal(result.name, 'verify');
  assert.equal(result.steps.length, 2);
  assert.match(formatHookRun(result), /first/);
  assert.match(formatHookRun(result), /second/);
});

test('runHook blocks dangerous configured commands', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-hooks-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      bad: ['rm -rf /']
    }
  }));

  await assert.rejects(
    () => runHook(root, 'bad'),
    /blocked/
  );
});

test('hook config rejects non-string commands', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-hooks-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: [{ command: 'npm run verify' }]
    }
  }));

  await assert.rejects(
    () => listHooks(root),
    /hook command must be a string/
  );
});

test('runHook reports failed command output with hook context', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-hooks-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      fail: ['node -e "console.error(\\"bad hook output\\"); process.exit(2)"']
    }
  }));

  await assert.rejects(
    () => runHook(root, 'fail'),
    error => {
      assert.match(error.message, /Hook failed: fail/);
      assert.match(error.message, /bad hook output/);
      return true;
    }
  );
});
