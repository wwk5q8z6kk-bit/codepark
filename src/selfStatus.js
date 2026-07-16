import fs from 'node:fs/promises';
import path from 'node:path';
import { gitStatus } from './git.js';

export async function createSelfStatus({ cwd, config }) {
  const packageInfo = await readPackageInfo(cwd);
  const sourceFiles = await listSourceFiles(path.join(cwd, 'src'));
  const status = await gitStatus(cwd).catch(() => '');
  const statusLine = status.split('\n').find(Boolean) ?? 'not a git repository';

  return [
    `CodePark is this CLI in ${cwd}.`,
    `Provider: ${config.provider || 'custom'} (${config.baseUrl}).`,
    `Package: ${packageInfo.name}@${packageInfo.version}.`,
    'Current surface: interactive prompt, first-run onboarding, secure setup, Codex no-key provider, project/search tools, local code intelligence, guarded file/shell/session/patch/quality-gate/checkpoint/task/worker/hook tools, doctor diagnostics, local skills, git/diff/session/token controls, project rules, and MCP execution.',
    `Source modules: ${formatFileList(sourceFiles)}.`,
    `Git: ${statusLine}.`,
    'Execution mode: can inspect this codebase, edit it, verify it, commit it, and relaunch it from the terminal.'
  ].join('\n');
}

async function readPackageInfo(cwd) {
  const fallback = { name: 'unknown', version: 'unknown' };
  try {
    const text = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
    const parsed = JSON.parse(text);
    return {
      name: parsed.name ?? fallback.name,
      version: parsed.version ?? fallback.version
    };
  } catch {
    return fallback;
  }
}

async function listSourceFiles(srcDir) {
  const files = [];
  await walk(srcDir, srcDir, files).catch(() => {});
  return files.sort();
}

async function walk(root, directory, files) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.relative(root, absolute));
    }
  }
}

function formatFileList(files) {
  if (!files.length) return 'none found';
  const shown = files.slice(0, 8).join(', ');
  return files.length > 8 ? `${shown}, and ${files.length - 8} more` : shown;
}
