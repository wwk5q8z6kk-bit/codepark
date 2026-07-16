import fs from 'node:fs/promises';
import path from 'node:path';

export const defaultIgnoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'target', 'coverage']);

export async function findFiles({ root, directory, pattern, maxResults = 100, ignore = defaultIgnoredDirs }) {
  if (!pattern) throw new Error('find_files requires a pattern');
  const matches = [];
  const matcher = createGlobMatcher(pattern);
  await walkFiles({ root, directory, ignore, onFile: async file => {
    const relative = normalizePath(path.relative(root, file));
    if (matcher(relative)) matches.push(relative);
    return matches.length < maxResults;
  } });
  return matches.length ? matches.join('\n') : `No files matched ${pattern}`;
}

export async function searchText({
  root,
  directory,
  pattern,
  regex = false,
  caseSensitive = true,
  maxMatches = 100,
  ignore = defaultIgnoredDirs
}) {
  if (!pattern) throw new Error('search_text requires a pattern');
  const matcher = createTextMatcher({ pattern, regex, caseSensitive });
  const matches = [];

  await walkFiles({ root, directory, ignore, onFile: async file => {
    const text = await readSearchableText(file);
    if (text === null) return matches.length < maxMatches;

    const relative = normalizePath(path.relative(root, file));
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (matcher(lines[index])) {
        matches.push(`${relative}:${index + 1}:${lines[index].trim()}`);
        if (matches.length >= maxMatches) return false;
      }
    }
    return true;
  } });

  return matches.length ? matches.join('\n') : `No matches for ${pattern}`;
}

async function walkFiles({ root, directory, ignore, onFile }) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (!isInside(root, absolute)) continue;
    if (entry.isDirectory()) {
      const shouldContinue = await walkFiles({ root, directory: absolute, ignore, onFile });
      if (shouldContinue === false) return false;
    } else if (entry.isFile()) {
      const shouldContinue = await onFile(absolute);
      if (shouldContinue === false) return false;
    }
  }
  return true;
}

async function readSearchableText(file) {
  const stat = await fs.stat(file);
  if (stat.size > 1024 * 1024) return null;
  const buffer = await fs.readFile(file);
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8');
}

function createGlobMatcher(pattern) {
  const normalized = normalizePath(pattern);
  const regex = globToRegExp(normalized);
  const basenameRegex = normalized.includes('/') ? null : globToRegExp(normalized);
  return relative => {
    const value = normalizePath(relative);
    return regex.test(value) || Boolean(basenameRegex?.test(path.posix.basename(value)));
  };
}

function globToRegExp(pattern) {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }
  source += '$';
  return new RegExp(source);
}

function createTextMatcher({ pattern, regex, caseSensitive }) {
  if (regex) {
    const expression = new RegExp(pattern, caseSensitive ? '' : 'i');
    return line => expression.test(line);
  }
  const needle = caseSensitive ? pattern : pattern.toLowerCase();
  return line => {
    const haystack = caseSensitive ? line : line.toLowerCase();
    return haystack.includes(needle);
  };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizePath(value) {
  return String(value).split(path.sep).join('/');
}

function escapeRegExp(value) {
  return value.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
}
