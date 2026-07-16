import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runQualityGate, selectQualityGateScripts } from '../src/qualityGate.js';

test('selectQualityGateScripts prefers verify when available', () => {
  const scripts = selectQualityGateScripts({
    verify: 'npm run check && npm test',
    check: 'node --check index.js',
    test: 'node --test'
  });

  assert.deepEqual(scripts, ['verify']);
});

test('selectQualityGateScripts falls back to check, lint, typecheck, and test', () => {
  const scripts = selectQualityGateScripts({
    test: 'node --test',
    lint: 'eslint .',
    typecheck: 'tsc --noEmit',
    check: 'node --check index.js'
  });

  assert.deepEqual(scripts, ['check', 'lint', 'typecheck', 'test']);
});

test('runQualityGate runs detected package scripts and reports output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-quality-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      verify: 'node -e "console.log(\\"verified from quality gate\\")"'
    }
  }));

  const result = await runQualityGate(root);

  assert.match(result, /Quality gate plan: npm run verify/);
  assert.match(result, /verified from quality gate/);
  assert.match(result, /Quality gate passed/);
});
