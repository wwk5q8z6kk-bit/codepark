import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNodeVersion, hasBroadWindowsAclWrite, runDoctor } from '../src/doctor.js';
import { defaultLauncherName, installLauncher } from '../src/launcher.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mockMcpServer = path.join(repoRoot, 'fixtures', 'mock-mcp-server.js');

test('checkNodeVersion returns ok on current node', () => {
  const result = checkNodeVersion(process.versions.node);
  assert.equal(result.ok, true);
});

test('checkNodeVersion fails old node', () => {
  const result = checkNodeVersion('16.0.0');
  assert.equal(result.ok, false);
});

test('hasBroadWindowsAclWrite rejects generic and granular writes', () => {
  assert.equal(hasBroadWindowsAclWrite('Everyone:(I)(WD,AD)'), true);
  assert.equal(hasBroadWindowsAclWrite('NT AUTHORITY\\Authenticated Users:(M)'), true);
  assert.equal(hasBroadWindowsAclWrite('BUILTIN\\Users:(GW)'), true);
  assert.equal(hasBroadWindowsAclWrite('Everyone:(GA)'), true);
  assert.equal(hasBroadWindowsAclWrite('BUILTIN\\Users:(RX)'), false);
  assert.equal(hasBroadWindowsAclWrite('EXAMPLE\\owner:(F)'), false);
});

test('runDoctor reports local workflow files', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.mkdir(path.join(cwd, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { verify: ['npm run verify'] }
  }));
  await fs.writeFile(path.join(cwd, '.codepark', 'skills', 'review.md'), '# Review\n');
  await fs.writeFile(path.join(cwd, '.codepark', 'tasks.json'), JSON.stringify({
    tasks: [
      { id: 'task-1', title: 'Open task', status: 'open' },
      { id: 'task-2', title: 'Done task', status: 'done' }
    ]
  }));
  await fs.writeFile(path.join(cwd, '.codepark', 'workers.json'), JSON.stringify({
    workers: [
      {
        id: 'worker-1',
        taskId: 'task-1',
        taskTitle: 'Open task',
        command: 'node worker.js',
        cwd,
        status: 'done',
        pid: null,
        exitCode: 0,
        logPath: '.codepark/workers/worker-1.log',
        statusPath: '.codepark/workers/worker-1.status.json',
        createdAt: '2026-04-18T12:00:00.000Z',
        updatedAt: '2026-04-18T12:01:00.000Z'
      }
    ]
  }));
  await fs.writeFile(path.join(cwd, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: 'node', args: ['server.js'] }
    }
  }));

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.workspace.ok, true);
  assert.equal(report.workspace.message, cwd);
  assert.equal(report.hooks.ok, true);
  assert.match(report.hooks.message, /1 hook/);
  assert.equal(report.skills.ok, true);
  assert.match(report.skills.message, /1 local skill/);
  assert.equal(report.tasks.ok, true);
  assert.match(report.tasks.message, /1 open/);
  assert.match(report.tasks.message, /1 done/);
  assert.equal(report.workers.ok, true);
  assert.match(report.workers.message, /1 worker/);
  assert.match(report.workers.message, /0 running/);
  assert.equal(report.mcp.ok, true);
  assert.match(report.mcp.message, /1 MCP server/);
});

test('runDoctor reports local command and launcher readiness', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-launcher-'));
  const binDir = path.join(cwd, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  if (process.platform === 'win32') {
    await fs.writeFile(
      path.join(binDir, 'codepark.cmd'),
      `@echo off\r\n"${process.execPath}" "${path.join(repoRoot, 'bin', 'codepark.js')}" %*\r\n`
    );
  } else {
    await fs.symlink(path.join(repoRoot, 'bin', 'codepark.js'), path.join(binDir, 'codepark'));
  }
  await installLauncher(cwd);

  const report = await runDoctor(
    { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' },
    { cwd, env: { PATH: binDir } }
  );

  assert.equal(report.command.ok, true);
  assert.match(report.command.message, /codepark/);
  assert.equal(report.launcher.ok, true);
  assert.match(report.launcher.message, /secure workspace-boot launcher ready/);
});

test('runDoctor reports launchers that do not boot the workspace harness', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-stale-launcher-'));
  const launcher = path.join(cwd, defaultLauncherName());
  await fs.writeFile(launcher, [
    '#!/bin/sh',
    'set -eu',
    "cd . && if command -v codepark >/dev/null 2>&1; then exec codepark --secure; else exec node ./bin/codepark.js --secure; fi",
    ''
  ].join('\n'), { mode: 0o755 });

  const report = await runDoctor(
    { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' },
    { cwd, env: { PATH: '' } }
  );

  assert.equal(report.launcher.ok, false);
  assert.match(report.launcher.message, /needs update/);
  assert.match(report.launcher.message, /boot/);
});

test('runDoctor reports missing launchers', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-no-launcher-'));

  const report = await runDoctor(
    { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' },
    { cwd, env: { PATH: '' } }
  );

  assert.equal(report.command.ok, false);
  assert.match(report.command.message, /not found on PATH/);
  assert.equal(report.launcher.ok, false);
  assert.match(report.launcher.message, new RegExp(`${defaultLauncherName().replace('.', '\\.')} not found`));
});

test('runDoctor reports secure config storage permissions', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-config-dir-'));
  const configPath = path.join(configDir, 'config.json');
  await fs.chmod(configDir, 0o700);
  await fs.writeFile(configPath, '{}\n', { mode: 0o600 });

  const report = await runDoctor(
    { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' },
    { cwd, configDir, configPath }
  );

  assert.equal(report.configDir.ok, true);
  assert.match(report.configDir.message, process.platform === 'win32' ? /ACL does not grant broad write access/ : /0700/);
  assert.equal(report.configFile.ok, true);
  assert.match(report.configFile.message, process.platform === 'win32' ? /ACL does not grant broad write access/ : /0600/);
});

test('runDoctor reports insecure config storage permissions', { skip: process.platform === 'win32' }, async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-config-dir-'));
  const configPath = path.join(configDir, 'config.json');
  await fs.chmod(configDir, 0o755);
  await fs.writeFile(configPath, '{}\n', { mode: 0o644 });

  const report = await runDoctor(
    { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' },
    { cwd, configDir, configPath }
  );

  assert.equal(report.configDir.ok, false);
  assert.match(report.configDir.message, /expected 0700/);
  assert.equal(report.configFile.ok, false);
  assert.match(report.configFile.message, /expected 0600/);
});

test('runDoctor reports malformed hook config', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'hooks.json'), '{bad json');

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.hooks.ok, false);
  assert.match(report.hooks.message, /invalid/);
});

test('runDoctor reports hook validation errors', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { verify: [] }
  }));

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.hooks.ok, false);
  assert.match(report.hooks.message, /hook has no commands/);
});

test('runDoctor reports non-string hook commands', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: [{ command: 'npm run verify' }]
    }
  }));

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.hooks.ok, false);
  assert.match(report.hooks.message, /hook command must be a string/);
});

test('runDoctor reports task ledger validation errors', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'tasks.json'), JSON.stringify({
    tasks: [
      { id: 'task-1', title: 'Blocked task', status: 'blocked' }
    ]
  }));

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.tasks.ok, false);
  assert.match(report.tasks.message, /task status must be open or done/);
});

test('runDoctor reports malformed task ledger entries', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'tasks.json'), JSON.stringify({
    tasks: [
      { id: 'task-1', title: '', status: 'open' }
    ]
  }));

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.tasks.ok, false);
  assert.match(report.tasks.message, /task title is required/);
});

test('runDoctor reports malformed worker ledger entries', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.mkdir(path.join(cwd, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codepark', 'workers.json'), JSON.stringify({
    workers: [
      { id: '', taskId: 'task-1', command: 'node worker.js' }
    ]
  }));

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.workers.ok, false);
  assert.match(report.workers.message, /worker id is required/);
});

test('runDoctor reports malformed MCP config', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.writeFile(path.join(cwd, '.codepark.mcp.json'), '{bad json');

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.mcp.ok, false);
  assert.match(report.mcp.message, /invalid/);
});

test('runDoctor reports invalid MCP server entries', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.writeFile(path.join(cwd, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      broken: { args: ['server.js'] }
    }
  }));

  const report = await runDoctor({ provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }, { cwd });

  assert.equal(report.mcp.ok, false);
  assert.match(report.mcp.message, /MCP server command is required/);
});

test('runDoctor can probe MCP server health', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.writeFile(path.join(cwd, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [mockMcpServer] }
    }
  }));

  const report = await runDoctor(
    { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' },
    { cwd, mcpHealth: true }
  );

  assert.equal(report.mcp.ok, true);
  assert.match(report.mcp.message, /mock/);
  assert.match(report.mcp.message, /1 tool/);
});

test('runDoctor reports MCP health failures', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-'));
  await fs.writeFile(path.join(cwd, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      broken: { command: process.execPath, args: ['missing-server.js'] }
    }
  }));

  const report = await runDoctor(
    { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' },
    { cwd, mcpHealth: true }
  );

  assert.equal(report.mcp.ok, false);
  assert.match(report.mcp.message, /broken/);
});
