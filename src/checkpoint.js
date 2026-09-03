import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const checkpointRoot = '.codepark/checkpoints';

export async function createCheckpoint(cwd, options = {}) {
  await assertGitRepo(cwd);
  const name = String(options.name ?? '').trim() || 'checkpoint';
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${slugify(name)}`;
  const relativeDir = `${checkpointRoot}/${id}`;
  const absoluteDir = path.join(cwd, relativeDir);
  const untrackedFiles = await listUntrackedFiles(cwd);
  const patch = await git(cwd, ['diff', '--binary', 'HEAD']);
  const head = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim();
  const branch = (await git(cwd, ['branch', '--show-current'])).trim() || '(detached)';
  const status = (await git(cwd, ['status', '--short'])).trim();

  await fs.mkdir(path.join(absoluteDir, 'untracked'), { recursive: true });
  await fs.writeFile(path.join(absoluteDir, 'tracked.patch'), patch);

  for (const relativeFile of untrackedFiles) {
    const source = path.join(cwd, relativeFile);
    const target = path.join(absoluteDir, 'untracked', relativeFile);
    if (!isInside(cwd, source)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }

  const metadata = {
    id,
    name,
    createdAt,
    branch,
    head,
    status,
    patchFile: path.join(relativeDir, 'tracked.patch'),
    untrackedDir: path.join(relativeDir, 'untracked'),
    untrackedFiles
  };
  await fs.writeFile(path.join(absoluteDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

export async function listCheckpoints(cwd) {
  const root = path.join(cwd, checkpointRoot);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const checkpoints = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = path.join(root, entry.name, 'metadata.json');
    const metadata = await fs.readFile(metadataPath, 'utf8').catch(() => null);
    if (!metadata) continue;
    checkpoints.push(JSON.parse(metadata));
  }
  checkpoints.sort((first, second) => second.id.localeCompare(first.id));
  return checkpoints;
}

export async function restoreCheckpoint(cwd, selector) {
  await assertGitRepo(cwd);
  const checkpoint = await resolveCheckpoint(cwd, selector);
  const patch = await fs.readFile(path.join(cwd, checkpoint.patchFile), 'utf8');
  const restoredUntrackedFiles = [];
  let appliedPatch = false;

  if (patch.trim()) {
    await gitWithInput(cwd, ['apply', '--check', '--whitespace=nowarn', '-'], patch);
    await gitWithInput(cwd, ['apply', '--whitespace=nowarn', '-'], patch);
    appliedPatch = true;
  }

  for (const relativeFile of checkpoint.untrackedFiles) {
    const source = path.join(cwd, checkpoint.untrackedDir, relativeFile);
    const target = path.join(cwd, relativeFile);
    if (!isInside(cwd, target)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    restoredUntrackedFiles.push(relativeFile);
  }

  return { checkpoint, appliedPatch, restoredUntrackedFiles };
}

export function formatCheckpointCreated(checkpoint) {
  return [
    `Checkpoint created: ${checkpoint.name}`,
    `id: ${checkpoint.id}`,
    `head: ${checkpoint.head} (${checkpoint.branch})`,
    `patch: ${checkpoint.patchFile}`,
    `untracked files: ${checkpoint.untrackedFiles.length ? checkpoint.untrackedFiles.join(', ') : 'none'}`
  ].join('\n');
}

export function formatCheckpointList(checkpoints) {
  if (!checkpoints.length) return 'No checkpoints found.';
  return checkpoints.map(checkpoint => [
    `${checkpoint.id} - ${checkpoint.name}`,
    `  head: ${checkpoint.head} (${checkpoint.branch})`,
    `  patch: ${checkpoint.patchFile}`,
    `  untracked: ${checkpoint.untrackedFiles.length}`
  ].join('\n')).join('\n');
}

export function formatCheckpointRestored(result) {
  return [
    `Checkpoint restored: ${result.checkpoint.name}`,
    `id: ${result.checkpoint.id}`,
    `tracked patch: ${result.appliedPatch ? 'applied' : 'empty'}`,
    `untracked files: ${result.restoredUntrackedFiles.length ? result.restoredUntrackedFiles.join(', ') : 'none'}`
  ].join('\n');
}

async function resolveCheckpoint(cwd, selector) {
  const value = String(selector ?? '').trim();
  if (!value) throw new Error('restore checkpoint requires an id, prefix, or name');
  const checkpoints = await listCheckpoints(cwd);
  const matches = checkpoints.filter(checkpoint => (
    checkpoint.id === value
    || checkpoint.id.startsWith(value)
    || checkpoint.name === value
  ));
  if (matches.length === 0) throw new Error(`checkpoint not found: ${value}`);
  if (matches.length > 1) throw new Error(`checkpoint selector is ambiguous: ${value}`);
  return matches[0];
}

async function assertGitRepo(cwd) {
  const output = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (output.trim() !== 'true') throw new Error('checkpoint requires a git repository');
}

async function listUntrackedFiles(cwd) {
  const output = await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  return output
    .split('\0')
    .filter(Boolean)
    .filter(file => !file.startsWith(`${checkpointRoot}/`))
    .sort();
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 30000,
    maxBuffer: 5 * 1024 * 1024
  });
  return stdout;
}

function gitWithInput(cwd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `git ${args.join(' ')} failed`).trim()));
    });
    child.stdin.end(input);
  });
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'checkpoint';
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
