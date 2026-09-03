import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSubprocessEnv } from './env.js';
import { detectPackageManager, readPackageJson } from './project.js';
import { commandShell, isWindows } from './platform.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const qualityScriptOrder = ['check', 'lint', 'typecheck', 'test'];

export function selectQualityGateScripts(scripts = {}) {
  if (scripts.verify) return ['verify'];
  return qualityScriptOrder.filter(script => scripts[script]);
}

export async function runQualityGate(cwd, options = {}) {
  const packageJson = await readPackageJson(cwd);
  if (!packageJson) throw new Error(`No package.json found in ${cwd}`);

  const scripts = selectQualityGateScripts(packageJson.scripts ?? {});
  if (!scripts.length) {
    throw new Error('No quality gate scripts found. Add verify, check, lint, typecheck, or test to package.json.');
  }

  const packageManager = await detectPackageManager(cwd);
  const commands = scripts.map(script => formatPackageScriptCommand(packageManager, script));
  const lines = [
    `Quality gate plan: ${commands.join(' && ')}`
  ];

  for (const script of scripts) {
    const command = formatPackageScriptCommand(packageManager, script);
    lines.push('', `$ ${command}`);
    try {
      const { stdout, stderr } = await runPackageScript(cwd, packageManager, script, options.timeoutMs);
      const output = trimOutput([stdout, stderr].filter(Boolean).join('\n'));
      if (output) lines.push(output);
    } catch (error) {
      const output = error?.stdout || error?.stderr
        ? trimOutput([error.stdout, error.stderr].filter(Boolean).join('\n'))
        : '';
      if (output) lines.push(output);
      lines.push(`Quality gate failed at ${command}.`);
      throw new Error(lines.join('\n'));
    }
  }

  lines.push('', `Quality gate passed (${scripts.length} script${scripts.length === 1 ? '' : 's'}).`);
  return lines.join('\n');
}

function runPackageScript(cwd, packageManager, script, timeoutMs = 300000) {
  if (isWindows()) {
    return execAsync(`${packageManager} run ${script}`, {
      cwd,
      timeout: timeoutMs,
      env: createSubprocessEnv(process.env),
      maxBuffer: 1024 * 1024,
      shell: commandShell()
    });
  }
  return execFileAsync(packageManager, ['run', script], {
    cwd,
    timeout: timeoutMs,
    env: createSubprocessEnv(process.env),
    maxBuffer: 1024 * 1024
  });
}

export function formatPackageScriptCommand(packageManager, script) {
  return `${packageManager} run ${script}`;
}

function trimOutput(value) {
  const output = String(value ?? '').trim();
  if (!output) return '';
  const max = 60000;
  return output.length > max ? `${output.slice(0, max)}\n[truncated]` : output;
}
