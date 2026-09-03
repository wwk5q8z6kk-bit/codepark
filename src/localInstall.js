import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initHarness, formatHarnessInit } from './harness.js';
import { defaultLauncherName, installLauncher, formatLauncherInstall } from './launcher.js';
import { initWorkspaceProfile, formatWorkspaceProfileInit } from './workspaceProfile.js';
import { isWindows } from './platform.js';

const codeparkBinPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'codepark.js');

export async function installLocal(cwd, options = {}) {
  const binDir = resolveBinDir(options.binDir);
  const command = await installCommand(binDir, { force: Boolean(options.force) });
  const profile = await runWorkspaceStep(() => initWorkspaceProfile(cwd, { force: Boolean(options.force) }), formatWorkspaceProfileInit);
  const harness = await runWorkspaceStep(() => initHarness(cwd, { force: Boolean(options.force) }), formatHarnessInit);
  const launcher = await runWorkspaceStep(() => installLauncher(cwd, { force: Boolean(options.force) }), formatLauncherInstall);

  return {
    binDir,
    command,
    profile,
    harness,
    launcher
  };
}

export function formatLocalInstall(result) {
  return [
    'CodePark local install',
    formatStep('command', result.command),
    formatStep('profile', result.profile),
    formatStep('harness', result.harness),
    formatStep('launcher', result.launcher),
    '',
    `Command path: ${result.command.path}`,
    process.env.PATH?.split(path.delimiter).includes(result.binDir)
      ? 'PATH: command directory is already on PATH'
      : `PATH: add ${result.binDir} to PATH if your shell cannot find codepark`,
    process.platform === 'darwin'
      ? `Next: double-click ${defaultLauncherName()} or run codepark workspace-boot --secure from this workspace.`
      : 'Next: run codepark workspace-boot --secure from this workspace.'
  ].join('\n');
}

async function installCommand(binDir, options = {}) {
  const target = path.join(binDir, isWindows() ? 'codepark.cmd' : 'codepark');
  await fs.mkdir(binDir, { recursive: true });
  await fs.chmod(codeparkBinPath, 0o755).catch(() => {});

  const existing = await readExistingTarget(target);
  if (existing.exists) {
    if (await existingPointsToCodePark(target, existing)) {
      return { ok: true, action: 'unchanged', path: target, message: `codepark already points to ${codeparkBinPath}` };
    }
    if (!options.force) {
      throw new Error(`${target} already exists; re-run with --force to replace it`);
    }
    await fs.unlink(target);
  }

  if (isWindows()) {
    await fs.writeFile(target, `@echo off\r\n${windowsQuote(process.execPath)} ${windowsQuote(codeparkBinPath)} %*\r\n`);
  } else {
    await fs.symlink(codeparkBinPath, target);
  }
  return { ok: true, action: existing.exists ? 'rewrote' : 'wrote', path: target, message: `${target} -> ${codeparkBinPath}` };
}

async function existingPointsToCodePark(target, existing) {
  if (existing.isSymlink) return resolveLinkTarget(target, existing.linkTarget) === codeparkBinPath;
  if (!isWindows()) return false;
  const content = await fs.readFile(target, 'utf8').catch(() => '');
  return content.includes(windowsQuote(codeparkBinPath));
}

async function readExistingTarget(target) {
  try {
    const stat = await fs.lstat(target);
    const isSymlink = stat.isSymbolicLink();
    return {
      exists: true,
      isSymlink,
      linkTarget: isSymlink ? await fs.readlink(target) : ''
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, isSymlink: false, linkTarget: '' };
    throw error;
  }
}

async function runWorkspaceStep(run, format) {
  try {
    const result = await run();
    return { ok: true, action: result.overwritten ? 'rewrote' : 'wrote', message: format(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists/.test(message)) return { ok: true, action: 'skipped', message };
    return { ok: false, action: 'failed', message };
  }
}

function formatStep(name, step) {
  const status = step.ok ? 'ok' : 'fail';
  const firstLine = String(step.message ?? '').split(/\r?\n/)[0] || step.action;
  return `${status} ${name}: ${firstLine}`;
}

function resolveBinDir(value) {
  if (value) return path.resolve(expandHome(String(value)));
  if (process.platform === 'darwin') return '/usr/local/bin';
  return path.join(os.homedir(), '.local', 'bin');
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(os.homedir(), value.slice(2));
  return value;
}

function windowsQuote(value) {
  return `"${String(value).replace(/%/g, '%%').replace(/"/g, '""')}"`;
}

function resolveLinkTarget(target, linkTarget) {
  return path.resolve(path.isAbsolute(linkTarget) ? linkTarget : path.join(path.dirname(target), linkTarget));
}
