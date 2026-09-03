import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getConfigDir, getConfigPath, modelAuthStatus } from './config.js';
import { listHooks } from './hooks.js';
import { loadWorkspaceMcpConfig } from './mcp/config.js';
import { listWorkspaceMcpTools } from './mcp/runtime.js';
import { inspectLauncher } from './launcher.js';
import { listLocalSkills } from './skills.js';
import { listTasks } from './tasks.js';
import { listWorkers } from './workers.js';
import { executableNames, isWindows } from './platform.js';

const execFileAsync = promisify(execFile);

export function checkNodeVersion(version) {
  const major = Number(String(version).split('.')[0]);
  return {
    ok: major >= 18,
    message: major >= 18 ? `Node ${version}` : `Node ${version} is too old; use Node 18+`
  };
}

export async function runDoctor(config, options = {}) {
  const auth = modelAuthStatus(config);
  const cwd = options.cwd || config.cwd || process.cwd();
  const configDir = options.configDir || getConfigDir();
  const configPath = options.configPath || getConfigPath();
  return {
    node: checkNodeVersion(process.versions.node),
    workspace: { ok: true, message: cwd },
    command: await checkCodeParkCommand(options.env || process.env),
    launcher: await checkLauncher(cwd),
    configDir: await checkPermission(configDir, 0o700, 'config directory'),
    configFile: await checkPermission(configPath, 0o600, 'config file'),
    provider: { ok: true, message: config.provider || 'custom' },
    model: { ok: Boolean(config.model), message: config.model || 'model not set' },
    apiKey: { ok: auth.ok, message: auth.message },
    baseUrl: { ok: Boolean(config.baseUrl), message: config.baseUrl || 'base URL missing' },
    hooks: await checkHooks(cwd),
    skills: await checkSkills(cwd),
    tasks: await checkTasks(cwd),
    workers: await checkWorkers(cwd),
    mcp: await checkMcp(cwd, { mcpHealth: Boolean(options.mcpHealth) })
  };
}

export function formatDoctorReport(report) {
  return Object.entries(report)
    .map(([name, result]) => `${result.ok ? 'ok' : 'fail'} ${name}: ${result.message}`)
    .join('\n');
}

export function formatDoctorReportJson(report) {
  return JSON.stringify({ version: 1, ...report }, null, 2);
}

async function checkPermission(file, expectedMode, label) {
  try {
    const stat = await fs.stat(file);
    if (isWindows()) return checkWindowsAcl(file, label);
    const actual = stat.mode & 0o777;
    const expectedText = formatMode(expectedMode);
    const actualText = formatMode(actual);
    return {
      ok: actual === expectedMode,
      message: actual === expectedMode
        ? `${label} permissions ${actualText}`
        : `${label} permissions ${actualText}; expected ${expectedText}`
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, message: `${label} not found` };
    return { ok: false, message: `${label} unreadable: ${error.message}` };
  }
}

async function checkWindowsAcl(file, label) {
  try {
    const { stdout } = await execFileAsync('icacls', [file], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const broadWrite = hasBroadWindowsAclWrite(stdout);
    return {
      ok: !broadWrite,
      message: broadWrite
        ? `${label} ACL grants broad write access`
        : `${label} ACL does not grant broad write access`
    };
  } catch (error) {
    return { ok: false, message: `${label} ACL could not be verified: ${error.message}` };
  }
}

export function hasBroadWindowsAclWrite(acl) {
  return String(acl).split(/\r?\n/).some(line => {
    if (!/(?:Everyone|Authenticated Users|\\Users)(?:\s|:)/i.test(line)) return false;
    const rights = [...line.matchAll(/\(([^)]+)\)/g)]
      .flatMap(match => match[1].split(','))
      .map(right => right.trim().toUpperCase());
    return rights.some(right => [
      'F', 'M', 'W', 'GW', 'GA', 'WD', 'AD', 'WEA', 'WA', 'WDAC', 'WO', 'DC', 'D'
    ].includes(right));
  });
}

function formatMode(mode) {
  return mode.toString(8).padStart(4, '0');
}

async function checkCodeParkCommand(env) {
  const found = await findExecutable('codepark', env);
  if (!found) {
    return { ok: false, message: 'codepark not found on PATH; run node ./bin/codepark.js install-local or codepark install-local' };
  }
  const linkTarget = await fs.readlink(found).catch(() => '');
  return {
    ok: true,
    message: linkTarget ? `${found} -> ${linkTarget}` : found
  };
}

async function checkLauncher(cwd) {
  const launcher = await inspectLauncher(cwd);
  return {
    ok: launcher.ready,
    message: launcher.message
  };
}

async function findExecutable(name, env) {
  const pathValue = env?.PATH || '';
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const candidateName of executableNames(name, env)) {
      const candidate = path.join(directory, candidateName);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return '';
}

async function isExecutable(file) {
  try {
    await fs.access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkHooks(cwd) {
  const file = path.join(cwd, '.codepark', 'hooks.json');
  if (!await exists(file)) return { ok: true, message: 'no hooks configured' };
  try {
    const hooks = await listHooks(cwd);
    const count = hooks.length;
    return { ok: true, message: `${count} hook${count === 1 ? '' : 's'} configured` };
  } catch (error) {
    return { ok: false, message: `.codepark/hooks.json invalid: ${error.message}` };
  }
}

async function checkSkills(cwd) {
  const directory = path.join(cwd, '.codepark', 'skills');
  if (!await exists(directory)) return { ok: true, message: 'no local skills' };
  try {
    const count = (await listLocalSkills(cwd)).length;
    return { ok: true, message: `${count} local skill${count === 1 ? '' : 's'}` };
  } catch (error) {
    return { ok: false, message: `.codepark/skills invalid: ${error.message}` };
  }
}

async function checkTasks(cwd) {
  const file = path.join(cwd, '.codepark', 'tasks.json');
  if (!await exists(file)) return { ok: true, message: 'no task ledger' };
  try {
    const tasks = await listTasks(cwd);
    const open = tasks.filter(task => task.status === 'open').length;
    const done = tasks.filter(task => task.status === 'done').length;
    return { ok: true, message: `${open} open, ${done} done` };
  } catch (error) {
    return { ok: false, message: `.codepark/tasks.json invalid: ${error.message}` };
  }
}

async function checkWorkers(cwd) {
  const file = path.join(cwd, '.codepark', 'workers.json');
  if (!await exists(file)) return { ok: true, message: 'no workers' };
  try {
    const workers = await listWorkers(cwd);
    const running = workers.filter(worker => worker.status === 'running' || worker.status === 'starting').length;
    const failed = workers.filter(worker => worker.status === 'failed').length;
    return {
      ok: true,
      message: `${workers.length} worker${workers.length === 1 ? '' : 's'}, ${running} running, ${failed} failed`
    };
  } catch (error) {
    return { ok: false, message: `.codepark/workers.json invalid: ${error.message}` };
  }
}

async function checkMcp(cwd, options = {}) {
  try {
    if (options.mcpHealth) return await checkMcpHealth(cwd);
    const loaded = await loadWorkspaceMcpConfig(cwd);
    if (!loaded.exists) return { ok: true, message: 'no MCP config' };
    const count = Object.keys(loaded.config.servers).length;
    return { ok: true, message: `${count} MCP server${count === 1 ? '' : 's'} configured` };
  } catch (error) {
    return { ok: false, message: `.codepark.mcp.json invalid: ${error.message}` };
  }
}

async function checkMcpHealth(cwd) {
  const report = await listWorkspaceMcpTools(cwd);
  if (!report.exists) return { ok: true, message: 'no MCP config' };
  if (!report.entries.length) return { ok: true, message: 'MCP health ok: 0 servers configured' };

  const failures = report.entries.filter(entry => entry.error);
  const summaries = report.entries.map(entry => {
    if (entry.error) return `${entry.name}: ${entry.error}`;
    const count = entry.tools.length;
    return `${entry.name}: ${count} tool${count === 1 ? '' : 's'}`;
  });
  return {
    ok: failures.length === 0,
    message: `MCP health ${failures.length ? 'failed' : 'ok'}: ${summaries.join('; ')}`
  };
}

async function exists(file) {
  return fs.access(file).then(
    () => true,
    error => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  );
}
