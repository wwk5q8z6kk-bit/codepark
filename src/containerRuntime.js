import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { addTask } from './tasks.js';
import { startWorker } from './workers.js';
import { createSubprocessEnv } from './env.js';
import { evaluateCommandPolicy } from './security/commandPolicy.js';

const execAsync = promisify(exec);

const containerFiles = [
  'Containerfile',
  'Dockerfile',
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml'
];
const composeFiles = new Set([
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml'
]);

export async function detectContainerRuntime(cwd, options = {}) {
  const pathValue = options.path ?? process.env.PATH ?? '';
  const hasPodman = Boolean(await findExecutableOnPath('podman', pathValue));
  const hasDocker = Boolean(await findExecutableOnPath('docker', pathValue));
  const hasPodmanCompose = Boolean(await findExecutableOnPath('podman-compose', pathValue));
  const files = [];

  for (const file of containerFiles) {
    if (await exists(path.join(cwd, file))) files.push(file);
  }

  const runtime = hasPodman ? 'podman' : (hasPodmanCompose ? 'podman-compose' : (hasDocker ? 'docker' : ''));
  const risks = await scanContainerRisks(cwd, files);
  return {
    runtime,
    command: runtime,
    composeCommand: composeCommandForRuntime(runtime),
    files,
    risks,
    available: {
      podman: hasPodman,
      docker: hasDocker,
      podmanCompose: hasPodmanCompose
    }
  };
}

function composeCommandForRuntime(runtime) {
  if (runtime === 'podman') return 'podman compose';
  if (runtime === 'podman-compose') return 'podman-compose';
  if (runtime === 'docker') return 'docker compose';
  return '';
}

export function formatContainerRuntime(result) {
  const lines = [
    'Container runtime',
    `- runtime: ${result.runtime || 'not found'}`,
    `- command: ${result.command || 'none'}`,
    `- compose: ${result.composeCommand || 'none'}`,
    `- files: ${result.files.length ? result.files.join(', ') : 'none'}`,
    `- risks: ${result.risks?.length ? `${result.risks.length} found` : 'none'}`
  ];

  if (!result.runtime) {
    lines.push('', 'Install Podman or Docker to enable container-backed app workflows.');
  } else if (result.runtime === 'podman') {
    lines.push('', 'Podman is preferred for local container workflows when available.');
  }
  if (result.risks?.length) {
    lines.push('', 'Container risk scan:', ...result.risks.map(formatRiskLine));
  }

  return lines.join('\n');
}

export async function startCompose(cwd, options = {}) {
  const runtime = await detectContainerRuntime(cwd);
  validateContainerRisks(runtime.risks);
  const command = buildComposeCommand(runtime, options.detached ? ['up', '-d'] : ['up']);
  const task = await addTask(cwd, {
    title: `Run ${runtime.runtime} compose up`,
    labels: ['app', 'container', 'runtime'],
    notes: `Managed by CodePark compose-start.\ncommand: ${command}`
  });
  const worker = await startWorker(cwd, {
    taskId: task.id,
    command,
    id: options.id
  });

  return {
    runtime: runtime.runtime,
    command,
    task,
    worker,
    detached: Boolean(options.detached)
  };
}

export async function stopCompose(cwd, options = {}) {
  const runtime = await detectContainerRuntime(cwd);
  const command = buildComposeCommand(runtime, ['down']);
  if (evaluateCommandPolicy(command) === 'disabled') throw new Error('blocked by command safety policy');
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: options.timeoutMs ?? 300000,
    maxBuffer: 1024 * 1024,
    env: createSubprocessEnv(process.env),
    shell: process.env.SHELL || '/bin/sh'
  });
  return {
    runtime: runtime.runtime,
    command,
    stdout,
    stderr
  };
}

export function formatComposeStart(result) {
  return [
    `Compose started: ${result.worker.id}`,
    `runtime: ${result.runtime}`,
    `task: ${result.task.id}`,
    `command: ${result.command}`,
    `detached: ${result.detached ? 'yes' : 'no'}`,
    `log: ${result.worker.logPath}`,
    '',
    `Next: use /worker-read ${result.worker.id} --tail 80, /workers, or /compose-stop.`
  ].join('\n');
}

export function formatComposeStop(result) {
  return [
    'Compose stopped',
    `runtime: ${result.runtime}`,
    `$ ${result.command}`,
    trimOutput([result.stdout, result.stderr].filter(Boolean).join('\n'))
  ].join('\n');
}

export function buildComposeCommand(runtime, args = []) {
  if (!runtime?.runtime || !runtime.composeCommand) {
    throw new Error('No container compose runtime found. Install Podman or Docker.');
  }
  if (!hasComposeFile(runtime)) {
    throw new Error('No compose file found. Add compose.yaml, compose.yml, docker-compose.yaml, or docker-compose.yml.');
  }
  return [runtime.composeCommand, ...args].join(' ');
}

export async function scanContainerRisks(cwd, files = []) {
  const risks = [];
  for (const file of files.filter(file => composeFiles.has(file))) {
    const text = await fs.readFile(path.join(cwd, file), 'utf8').catch(error => {
      if (error?.code === 'ENOENT') return '';
      throw error;
    });
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      risks.push(...scanComposeLine(file, index + 1, lines[index]));
    }
  }
  return risks;
}

export function validateContainerRisks(risks = []) {
  const critical = risks.filter(risk => risk.level === 'critical');
  if (!critical.length) return;
  throw new Error([
    'Refusing compose-start because the Compose file contains critical container risks:',
    ...critical.map(formatRiskLine),
    'Edit the Compose file or start it manually after reviewing the risk.'
  ].join('\n'));
}

export async function findExecutableOnPath(name, pathValue) {
  const directories = String(pathValue ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  const names = process.platform === 'win32' ? windowsExecutableNames(name) : [name];

  for (const directory of directories) {
    for (const candidate of names) {
      const file = path.join(directory, candidate);
      if (await isExecutable(file)) return file;
    }
  }
  return '';
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(file) {
  try {
    await fs.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsExecutableNames(name) {
  const extensions = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean);
  return [name, ...extensions.map(extension => `${name}${extension.toLowerCase()}`), ...extensions.map(extension => `${name}${extension.toUpperCase()}`)];
}

function hasComposeFile(runtime) {
  return runtime.files.some(file => file === 'compose.yaml'
    || file === 'compose.yml'
    || file === 'docker-compose.yaml'
    || file === 'docker-compose.yml');
}

function scanComposeLine(file, line, value) {
  const risks = [];
  const text = String(value ?? '');
  if (/^\s*privileged\s*:\s*true\b/i.test(text)) {
    risks.push(risk('critical', file, line, 'privileged containers can bypass host isolation'));
  }
  if (/^\s*network_mode\s*:\s*['"]?host['"]?\b/i.test(text)) {
    risks.push(risk('critical', file, line, 'host networking exposes the host network namespace'));
  }
  if (/^\s*(pid|ipc)\s*:\s*['"]?host['"]?\b/i.test(text)) {
    risks.push(risk('critical', file, line, 'host pid/ipc namespace sharing weakens isolation'));
  }
  if (/docker\.sock/i.test(text)) {
    risks.push(risk('critical', file, line, 'mounting docker.sock grants host container control'));
  }
  if (/^\s*-\s*\/\s*:/i.test(text) || /^\s*source\s*:\s*\/\s*$/i.test(text)) {
    risks.push(risk('critical', file, line, 'mounting the host root filesystem exposes the host'));
  }
  if (/^\s*-\s*(?:~|\$HOME|\/Users\/|\/home\/)[^:]*:/i.test(text)) {
    risks.push(risk('warning', file, line, 'mounting a home directory may expose secrets and source code'));
  }
  if (/^\s*(devices|cap_add|security_opt)\s*:/i.test(text)) {
    risks.push(risk('warning', file, line, 'device, capability, or security option overrides need review'));
  }
  return risks;
}

function risk(level, file, line, message) {
  return { level, file, line, message };
}

function formatRiskLine(risk) {
  return `- ${risk.level}: ${risk.file}:${risk.line} ${risk.message}`;
}

function trimOutput(value) {
  const output = String(value ?? '').trim();
  if (!output) return '[command completed with no output]';
  const max = 60000;
  return output.length > max ? `${output.slice(0, max)}\n[truncated]` : output;
}
