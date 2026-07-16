import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkJavaScriptSyntax, collectJavaScriptFiles } from '../src/syntaxCheck.js';

test('collectJavaScriptFiles finds project javascript files deterministically', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-syntax-'));
  await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'test'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true });

  await fs.writeFile(path.join(root, 'src', 'nested', 'feature.js'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, 'src', 'index.mjs'), 'export {};\n');
  await fs.writeFile(path.join(root, 'bin', 'cli.js'), '#!/usr/bin/env node\nconsole.log("ok");\n');
  await fs.writeFile(path.join(root, 'test', 'feature.test.js'), 'import test from "node:test";\n');
  await fs.writeFile(path.join(root, 'src', 'ignored.txt'), 'not javascript\n');
  await fs.writeFile(path.join(root, 'node_modules', 'ignored', 'bad.js'), 'not collected\n');

  const files = await collectJavaScriptFiles(root);

  assert.deepEqual(files, [
    'bin/cli.js',
    'src/index.mjs',
    'src/nested/feature.js',
    'test/feature.test.js'
  ]);
});

test('checkJavaScriptSyntax reports invalid files with relative paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-syntax-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'broken.js'), 'function () {\n');

  await assert.rejects(
    () => checkJavaScriptSyntax(root),
    error => {
      assert.match(error.message, /Syntax check failed/);
      assert.match(error.message, /src\/broken\.js/);
      return true;
    }
  );
});

test('checkJavaScriptSyntax rejects shipped javascript outside checked roots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-syntax-'));
  await fs.mkdir(path.join(root, 'lib'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    files: ['lib/']
  }));
  await fs.writeFile(path.join(root, 'lib', 'shipped.js'), 'export const shipped = true;\n');

  await assert.rejects(
    () => checkJavaScriptSyntax(root),
    error => {
      assert.match(error.message, /Syntax check does not cover package JavaScript files/);
      assert.match(error.message, /lib\/shipped\.js/);
      return true;
    }
  );
});
