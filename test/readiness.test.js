import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installLauncher } from '../src/launcher.js';
import { createReadinessReport, formatReadinessReport } from '../src/readiness.js';

test('createReadinessReport summarizes endpoint and local posture', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-readiness-'));
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'demo-codepark',
    version: '1.2.3',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' }
  }));
  await fs.writeFile(path.join(cwd, 'README.md'), 'Private local project for personal use only.\n');

  const report = await createReadinessReport(cwd, {
    provider: 'codex',
    baseUrl: 'codex://cli',
    model: 'codex-cli-default',
    apiKey: ''
  });

  assert.equal(report.version, 1);
  assert.equal(report.endpoint.mode, 'codex-cli');
  assert.equal(report.endpoint.chatCompletionsUrl, 'codex CLI');
  assert.equal(report.package.name, 'demo-codepark');
  assert.equal(report.localUse.ready, true);
  assert.equal(report.secureHarness.ready, false);
  assert.ok(report.checks.secureHarness.some(check => check.name === 'secure-endpoint' && !check.ok));
  assert.match(formatReadinessReport(report), /Secure harness: not ready/);
  assert.match(formatReadinessReport(report), /Project:/);
});

test('createReadinessReport recognizes secure local harness posture', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-readiness-secure-'));
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'secure-codepark',
    version: '1.2.3',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' }
  }));
  await fs.writeFile(path.join(cwd, 'README.md'), '# Secure local project\n');
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'profile.json'), `${JSON.stringify({
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
  }, null, 2)}\n`);
  await installLauncher(cwd);

  const report = await createReadinessReport(cwd, {
    provider: 'codex',
    baseUrl: 'codex://cli',
    model: 'codex-cli-default',
    apiKey: '',
    localOnly: true,
    secureMode: true
  });

  assert.equal(report.localUse.ready, true);
  assert.equal(report.secureHarness.ready, true);
  assert.match(formatReadinessReport(report), /Secure harness: ready/);
});

test('createReadinessReport recognizes Java publish blocks as secure harness posture', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-readiness-java-'));
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({
    name: 'secure-java-codepark',
    version: '1.2.3',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' }
  }));
  await fs.writeFile(path.join(cwd, 'README.md'), '# Secure Java local project\n');
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      write: {
        allow: ['.codepark/**', 'src/**', 'pom.xml'],
        deny: ['.git/**', '.env', '.env.*', 'target/**']
      },
      commands: {
        denyCommands: ['sudo'],
        denyPatterns: ['mvn deploy']
      }
    }
  }, null, 2)}\n`);
  await installLauncher(cwd);

  const report = await createReadinessReport(cwd, {
    provider: 'codex',
    baseUrl: 'codex://cli',
    model: 'codex-cli-default',
    apiKey: '',
    localOnly: true,
    secureMode: true
  });

  assert.equal(report.secureHarness.ready, true);
  assert.ok(report.checks.secureHarness.some(check => check.name === 'deployment-commands' && check.ok));
});
