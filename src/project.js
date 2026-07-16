import fs from 'node:fs/promises';
import path from 'node:path';

export async function projectOverview(cwd, options = {}) {
  const packageJson = await readPackageJson(cwd);
  const packageManager = await detectPackageManager(cwd);
  if (!packageJson) return `No package.json found in ${cwd}`;

  const lines = [
    `${packageJson.name ?? 'unnamed'}@${packageJson.version ?? '0.0.0'}`,
    `packageManager: ${packageManager}`
  ];

  const scripts = Object.entries(packageJson.scripts ?? {});
  if (scripts.length) {
    lines.push('scripts:');
    for (const [name, command] of scripts) {
      lines.push(`  ${name}: ${command}`);
    }
  } else {
    lines.push('scripts: none');
  }

  if (options.scriptsOnly) return lines.join('\n');

  const dependencies = Object.keys(packageJson.dependencies ?? {});
  const devDependencies = Object.keys(packageJson.devDependencies ?? {});
  lines.push(`dependencies: ${formatList(dependencies)}`);
  lines.push(`devDependencies: ${formatList(devDependencies)}`);

  return lines.join('\n');
}

export async function readPackageJson(cwd) {
  try {
    const text = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function detectPackageManager(cwd) {
  const checks = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm']
  ];

  for (const [file, name] of checks) {
    if (await exists(path.join(cwd, file))) return name;
  }
  return 'npm';
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function formatList(items) {
  if (!items.length) return 'none';
  const shown = items.slice(0, 20).join(', ');
  return items.length > 20 ? `${shown}, and ${items.length - 20} more` : shown;
}
