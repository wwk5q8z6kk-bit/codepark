import fs from 'node:fs/promises';
import path from 'node:path';

export async function resolveWorkspacePath(root, requested, options = {}) {
  if (!requested) throw new Error('path is required');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path escapes workspace: ${requested}`);
  }

  const rootRealPath = await fs.realpath(resolvedRoot);
  const targetRealPath = await resolveRealTarget(resolved);
  assertInsideWorkspace(rootRealPath, targetRealPath, requested);

  if (options.mustExist || options.file || options.directory) {
    const stat = await fs.stat(resolved).catch(error => {
      if (error?.code === 'ENOENT') throw new Error(`path does not exist: ${requested}`);
      throw error;
    });
    if (options.file && !stat.isFile()) throw new Error(`not a file: ${requested}`);
    if (options.directory && !stat.isDirectory()) throw new Error(`not a directory: ${requested}`);
  }

  return resolved;
}

async function resolveRealTarget(resolved) {
  const realPath = await fs.realpath(resolved).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  });
  if (realPath) return realPath;
  const parent = path.dirname(resolved);
  const parentRealPath = await fs.realpath(parent);
  return path.join(parentRealPath, path.basename(resolved));
}

function assertInsideWorkspace(rootRealPath, targetRealPath, requested) {
  const relative = path.relative(rootRealPath, targetRealPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path escapes workspace: ${requested}`);
  }
}

export async function summarizeDirectory(target, { root, maxDepth, ignore }) {
  const lines = [];
  await walk(target, 0, lines, { root, maxDepth, ignore });
  return lines.join('\n') || '[empty directory]';
}

async function walk(directory, depth, lines, options) {
  if (depth > options.maxDepth || lines.length >= 250) return;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (lines.length >= 250) {
      lines.push('[truncated after 250 entries]');
      return;
    }
    if (options.ignore.has(entry.name)) continue;

    const fullPath = path.join(directory, entry.name);
    const rel = path.relative(options.root, fullPath) || '.';
    lines.push(entry.isDirectory() ? `${rel}/` : rel);
    if (entry.isDirectory()) {
      await walk(fullPath, depth + 1, lines, options);
    }
  }
}
