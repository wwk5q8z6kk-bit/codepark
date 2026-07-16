import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultLauncherName = 'CodePark.command';
const codeparkBinPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'codepark.js');

export async function inspectLauncher(cwd, options = {}) {
  const target = resolveLauncherTarget(cwd, options.target || defaultLauncherName);
  try {
    const [stat, text] = await Promise.all([
      fs.stat(target),
      fs.readFile(target, 'utf8')
    ]);
    const checks = {
      executable: Boolean((stat.mode & 0o111)),
      secure: text.includes('--secure'),
      boot: text.includes('workspace-boot'),
      fallback: text.includes('command -v codepark') && text.includes('bin/codepark.js'),
      pause: text.includes('Press Return to close this CodePark window.') || text.includes('Press Enter to close this CodePark window.')
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    return {
      configured: true,
      ready: failed.length === 0,
      path: path.relative(cwd, target),
      absolutePath: target,
      checks,
      message: failed.length ? `CodePark.command needs update: ${failed.join(', ')}` : 'CodePark.command secure workspace-boot launcher ready'
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        configured: false,
        ready: false,
        path: path.relative(cwd, target),
        absolutePath: target,
        checks: {
          executable: false,
          secure: false,
          boot: false,
          fallback: false,
          pause: false
        },
        message: 'CodePark.command not found; run codepark launcher-install or codepark install-local'
      };
    }
    return {
      configured: false,
      ready: false,
      path: path.relative(cwd, target),
      absolutePath: target,
      checks: {
        executable: false,
        secure: false,
        boot: false,
        fallback: false,
        pause: false
      },
      message: `CodePark.command unreadable: ${error.message}`
    };
  }
}

export async function installLauncher(cwd, options = {}) {
  const target = resolveLauncherTarget(cwd, options.target || defaultLauncherName);
  const command = buildCodeParkShellCommand(cwd, ['--secure', '--cwd', cwd, 'workspace-boot'], { exec: false });
  const pausePrompt = process.platform === 'darwin'
    ? 'Press Return to close this CodePark window.'
    : 'Press Enter to close this CodePark window.';
  const content = [
    '#!/bin/sh',
    'set -u',
    "echo 'CodePark workspace boot'",
    `echo 'Workspace: ${shellSingleQuoteContent(cwd)}'`,
    'echo',
    command,
    'status=$?',
    'echo',
    'if [ "$status" -eq 0 ]; then',
    "  echo 'CodePark workspace boot finished.'",
    'else',
    '  echo "CodePark workspace boot failed with exit code $status."',
    'fi',
    "echo 'Next commands: codepark workers | codepark dashboard-open | codepark doctor'",
    'echo',
    `printf '%s ' '${pausePrompt}'`,
    'read _codepark_pause || true',
    'exit "$status"',
    ''
  ].join('\n');

  let overwritten = false;
  if (options.force) {
    overwritten = await exists(target);
    await fs.writeFile(target, content, { mode: 0o755 });
  } else {
    await fs.writeFile(target, content, { flag: 'wx', mode: 0o755 }).catch(error => {
      if (error?.code === 'EEXIST') {
        throw new Error(`${path.relative(cwd, target)} already exists. Re-run with --force to replace it.`);
      }
      throw error;
    });
  }
  await fs.chmod(target, 0o755).catch(() => {});

  return {
    path: path.relative(cwd, target),
    absolutePath: target,
    command,
    overwritten
  };
}

export function formatLauncherInstall(result) {
  return [
    `${result.overwritten ? 'Rewrote' : 'Wrote'} ${result.path}`,
    `command: ${result.command}`,
    '',
    process.platform === 'darwin'
      ? `Next: double-click ${result.path} in Finder to boot the CodePark harness for this workspace.`
      : `Next: run ./${result.path} to boot the CodePark harness for this workspace.`
  ].join('\n');
}

export function buildCodeParkShellCommand(cwd, args = [], options = {}) {
  const normalizedArgs = args.map(value => String(value));
  const globalCommand = ['codepark', ...normalizedArgs].map(shellQuote).join(' ');
  const localCommand = [process.execPath, codeparkBinPath, ...normalizedArgs].map(shellQuote).join(' ');
  const prefix = options.exec === false ? '' : 'exec ';
  return `cd ${shellQuote(cwd)} && if command -v codepark >/dev/null 2>&1; then ${prefix}${globalCommand}; else ${prefix}${localCommand}; fi`;
}

function resolveLauncherTarget(cwd, target) {
  const raw = String(target ?? '').trim();
  if (!raw) throw new Error('launcher target is required');
  if (path.isAbsolute(raw)) throw new Error('launcher target must be relative to the workspace');
  const resolved = path.resolve(cwd, raw);
  const relative = path.relative(cwd, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('launcher target must stay inside the workspace');
  }
  return resolved;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function shellSingleQuoteContent(value) {
  return String(value).replace(/'/g, "'\\''");
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
