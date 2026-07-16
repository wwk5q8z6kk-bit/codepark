import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createAssessmentTasks,
  createProjectAssessment,
  formatAssessmentTasks,
  formatProjectAssessment
} from '../src/assessment.js';
import { installLauncher } from '../src/launcher.js';
import { listTasks } from '../src/tasks.js';

test('createProjectAssessment summarizes local, secure, and release posture', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-assessment-'));
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'assessed-app',
    version: '1.0.0',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' },
    scripts: {
      start: 'node server.js',
      verify: 'node --version'
    }
  }));
  await fs.writeFile(path.join(cwd, 'README.md'), 'Private local project for personal use only.\n');
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: ['npm run verify']
    }
  }));
  await fs.writeFile(path.join(cwd, '.codepark', 'profile.json'), JSON.stringify({
    policy: {
      write: {
        allow: ['.codepark/**', 'src/**', 'test/**', 'package.json'],
        deny: ['.git/**', 'node_modules/**', '.env', '.env.*']
      },
      commands: {
        denyCommands: ['sudo'],
        denyPatterns: ['npm publish', 'npm login']
      }
    }
  }));
  await installLauncher(cwd);

  const report = await createProjectAssessment(cwd, {
    provider: 'codex',
    baseUrl: 'codex://cli',
    model: 'codex-cli-default',
    apiKey: '',
    localOnly: true,
    secureMode: true
  });

  assert.equal(report.summary.localTestingReady, true);
  assert.equal(report.summary.secureHarnessReady, true);
  assert.match(formatProjectAssessment(report), /CodePark assessment/);
  assert.match(formatProjectAssessment(report), /local testing: ready/);
  assert.match(formatProjectAssessment(report), /secure harness: ready/);
});

test('createAssessmentTasks creates duplicate-safe local tasks for gaps', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-assessment-tasks-'));
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'tasked-app',
    version: '1.0.0',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' },
    scripts: { test: 'node --test' }
  }));
  await fs.writeFile(path.join(cwd, 'README.md'), 'Private local project for personal use only.\n');

  const config = {
    provider: 'codex',
    baseUrl: 'codex://cli',
    model: 'codex-cli-default',
    apiKey: ''
  };
  const first = await createAssessmentTasks(cwd, config);
  const second = await createAssessmentTasks(cwd, config);
  const tasks = await listTasks(cwd);

  assert.ok(first.added.length > 0);
  assert.equal(second.added.length, 0);
  assert.equal(second.skipped.length, first.added.length);
  assert.equal(tasks.length, first.added.length);
  assert.ok(tasks.every(task => task.labels.includes('assessment')));
  assert.ok(!tasks.some(task => task.title.includes('license: UNLICENSED')));
  assert.match(formatAssessmentTasks(first), /Assessment tasks/);
});
