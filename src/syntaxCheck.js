import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const defaultRoots = ['bin', 'docs', 'src', 'test', 'fixtures'];
const defaultExcludedDirectories = new Set([
  '.autonomous',
  '.git',
  '.codepark',
  '.worktrees',
  'coverage',
  'dist',
  'node_modules'
]);
const syntaxExtensions = new Set(['.cjs', '.js', '.mjs']);

export async function collectJavaScriptFiles(root, options = {}) {
  const base = path.resolve(root);
  const roots = options.roots ?? defaultRoots;
  const excludedDirectories = new Set([
    ...defaultExcludedDirectories,
    ...(options.excludedDirectories ?? [])
  ]);
  const files = [];

  for (const relativeRoot of roots) {
    const absoluteRoot = path.resolve(base, relativeRoot);
    if (!isInside(base, absoluteRoot)) throw new Error(`syntax check root escapes workspace: ${relativeRoot}`);
    await walkJavaScriptFiles(base, absoluteRoot, excludedDirectories, files);
  }

  return files.sort();
}

export async function collectPackageJavaScriptFiles(root, options = {}) {
  const base = path.resolve(root);
  const packageJson = await readPackageJson(base);
  const packageFiles = packageJson?.files;
  if (!Array.isArray(packageFiles)) return [];

  const excludedDirectories = new Set([
    ...defaultExcludedDirectories,
    ...(options.excludedDirectories ?? [])
  ]);
  const files = new Set();

  for (const entry of packageFiles) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const absolutePath = path.resolve(base, entry);
    if (!isInside(base, absolutePath)) throw new Error(`package file entry escapes workspace: ${entry}`);
    await collectPackageEntryJavaScriptFiles(base, absolutePath, excludedDirectories, files);
  }

  return [...files].sort();
}

export async function checkJavaScriptSyntax(root, options = {}) {
  const base = path.resolve(root);
  const files = await collectJavaScriptFiles(base, options);
  const checkedFiles = new Set(files);
  const packageFiles = await collectPackageJavaScriptFiles(base, options);
  const missingPackageFiles = packageFiles.filter(file => !checkedFiles.has(file));
  if (missingPackageFiles.length) {
    throw new Error([
      'Syntax check does not cover package JavaScript files.',
      '',
      ...missingPackageFiles
    ].join('\n'));
  }

  const failures = [];

  for (const file of files) {
    const result = await runNodeCheck(base, file);
    if (result.code !== 0) {
      const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      failures.push(`${file}\n${output}`);
    }
  }

  if (failures.length) {
    throw new Error([
      `Syntax check failed for ${failures.length} file${failures.length === 1 ? '' : 's'}.`,
      '',
      failures.join('\n\n')
    ].join('\n'));
  }

  return `Syntax check passed (${files.length} file${files.length === 1 ? '' : 's'}).`;
}

async function collectPackageEntryJavaScriptFiles(base, absolutePath, excludedDirectories, files) {
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  if (stat.isDirectory()) {
    const collected = [];
    await walkJavaScriptFiles(base, absolutePath, excludedDirectories, collected);
    for (const file of collected) files.add(file);
    return;
  }

  if (stat.isFile() && syntaxExtensions.has(path.extname(absolutePath))) {
    files.add(toPosixPath(path.relative(base, absolutePath)));
  }
}

async function walkJavaScriptFiles(base, directory, excludedDirectories, files) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        await walkJavaScriptFiles(base, absolutePath, excludedDirectories, files);
      }
      continue;
    }

    if (entry.isFile() && syntaxExtensions.has(path.extname(entry.name))) {
      files.push(toPosixPath(path.relative(base, absolutePath)));
    }
  }
}

function runNodeCheck(cwd, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function readPackageJson(base) {
  try {
    return JSON.parse(await fs.readFile(path.join(base, 'package.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
