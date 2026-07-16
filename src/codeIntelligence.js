import fs from 'node:fs/promises';
import path from 'node:path';

const defaultIgnoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  'target',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.parcel-cache',
  'out'
]);

const javascriptExtensions = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const pythonExtensions = new Set(['.py', '.pyi']);

export async function createCodeIndex(cwd, options = {}) {
  const root = path.resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd());
  const maxFiles = clampNumber(options.maxFiles, 1, 50000, 250);
  const maxBytes = clampNumber(options.maxBytes, 1, 50 * 1024 * 1024, 256 * 1024);
  const maxDepth = clampNumber(options.maxDepth, 0, 50, 12);
  const ignore = toIgnoreSet(options.ignore);

  const index = emptyIndex(root, { maxFiles, maxBytes, maxDepth });
  const rootStat = await fs.stat(root).catch(error => {
    addRootDiagnostic(index, root, error);
    return null;
  });

  if (!rootStat || !rootStat.isDirectory()) {
    if (rootStat && !rootStat.isDirectory()) {
      index.diagnostics.push({
        path: '',
        severity: 'error',
        message: `cwd is not a directory: ${root}`
      });
    }
    return finalizeIndex(index);
  }

  let reachedLimit = false;
  await walkSourceFiles({
    root,
    directory: root,
    ignore,
    maxDepth,
    onFile: async file => {
      if (index.metadata.scannedFiles >= maxFiles) {
        if (!reachedLimit) {
          index.diagnostics.push({
            path: '',
            severity: 'warning',
            message: `maxFiles limit reached after ${maxFiles} files`
          });
          reachedLimit = true;
        }
        return false;
      }

      const relativePath = toPosixPath(path.relative(root, file));
      const language = detectLanguage(file);
      if (!language) return true;

      let stat;
      try {
        stat = await fs.stat(file);
      } catch (error) {
        index.diagnostics.push({
          path: relativePath,
          severity: 'warning',
          message: `failed to stat file: ${formatErrorMessage(error)}`
        });
        return true;
      }

      if (stat.size > maxBytes) {
        index.diagnostics.push({
          path: relativePath,
          severity: 'warning',
          message: `skipped file larger than maxBytes (${stat.size} > ${maxBytes})`
        });
        return true;
      }

      const text = await readTextFile(file);
      if (text === null) {
        index.diagnostics.push({
          path: relativePath,
          severity: 'warning',
          message: 'skipped non-text file'
        });
        return true;
      }

      const fileRecord = {
        path: relativePath,
        language,
        size: stat.size,
        symbols: 0,
        imports: 0
      };

      const parsed = parseSourceFile({
        path: relativePath,
        language,
        text,
        root
      });

      fileRecord.symbols = parsed.symbols.length;
      fileRecord.imports = parsed.imports.length;
      index.files.push(fileRecord);
      index.symbols.push(...parsed.symbols);
      index.imports.push(...parsed.imports);
      index.metadata.scannedFiles += 1;
      return true;
    }
  });

  return finalizeIndex(index);
}

export async function findCodeSymbols(cwd, queryOrOptions = {}, maybeOptions = {}) {
  const query = normalizeSymbolQuery(queryOrOptions, maybeOptions);
  const index = query.index ?? await createCodeIndex(cwd, query.scanOptions);
  const results = index.symbols.filter(symbol => matchesSymbol(symbol, query));
  return sortSymbols(results).slice(0, query.limit);
}

export function formatCodeIndex(index, options = {}) {
  const value = normalizeIndexShape(index);
  const lines = [];
  const title = options.title ?? 'Code Index';
  lines.push(`${title}: ${path.basename(value.root) || value.root}`);
  lines.push(`root: ${value.root}`);
  lines.push(`files: ${value.files.length}`);
  lines.push(`symbols: ${value.symbols.length}`);
  lines.push(`imports: ${value.imports.length}`);

  if (value.files.length) {
    lines.push('indexed files:');
    for (const file of value.files.slice(0, options.maxFiles ?? 20)) {
      lines.push(`  ${file.path} [${file.language}] symbols: ${file.symbols} imports: ${file.imports}`);
    }
    if (value.files.length > (options.maxFiles ?? 20)) {
      lines.push(`  ... and ${value.files.length - (options.maxFiles ?? 20)} more`);
    }
  }

  if (value.symbols.length) {
    lines.push('symbols:');
    const maxSymbols = options.maxSymbols ?? 40;
    for (const symbol of value.symbols.slice(0, maxSymbols)) {
      const signature = symbol.signature || symbol.snippet || symbol.kind;
      lines.push(`  ${symbol.path}:${symbol.line} ${symbol.kind} ${symbol.name}${signature ? ` - ${signature}` : ''}`);
    }
    if (value.symbols.length > maxSymbols) {
      lines.push(`  ... and ${value.symbols.length - maxSymbols} more`);
    }
  }

  if (options.includeImports !== false && value.imports.length) {
    lines.push('imports:');
    const maxImports = options.maxImports ?? 30;
    for (const imported of value.imports.slice(0, maxImports)) {
      const names = imported.names?.length ? ` (${imported.names.join(', ')})` : '';
      lines.push(`  ${imported.path}:${imported.line} ${imported.kind} ${imported.source}${names}`);
    }
    if (value.imports.length > maxImports) {
      lines.push(`  ... and ${value.imports.length - maxImports} more`);
    }
  }

  if (value.diagnostics.length) {
    lines.push('diagnostics:');
    for (const diagnostic of value.diagnostics.slice(0, options.maxDiagnostics ?? 10)) {
      const prefix = diagnostic.path ? `${diagnostic.path}: ` : '';
      lines.push(`  ${prefix}${diagnostic.severity}: ${diagnostic.message}`);
    }
    if (value.diagnostics.length > (options.maxDiagnostics ?? 10)) {
      lines.push(`  ... and ${value.diagnostics.length - (options.maxDiagnostics ?? 10)} more`);
    }
  } else {
    lines.push('diagnostics: none');
  }

  return lines.join('\n');
}

export function formatCodeSymbolResults(results, options = {}) {
  const symbols = Array.isArray(results)
    ? results
    : Array.isArray(results?.symbols)
      ? results.symbols
      : Array.isArray(results?.results)
        ? results.results
        : [];

  if (!symbols.length) return options.emptyMessage ?? 'No code symbols found.';

  const lines = [];
  if (options.title !== false) lines.push(options.title ?? 'Code Symbols:');
  const limit = clampNumber(options.maxResults, 1, 5000, 50);
  for (const symbol of sortSymbols(symbols).slice(0, limit)) {
    const signature = symbol.signature || symbol.snippet || symbol.kind;
    lines.push(`${symbol.path}:${symbol.line} ${symbol.kind} ${symbol.name}${signature ? ` - ${signature}` : ''}`);
  }
  if (symbols.length > limit) {
    lines.push(`... and ${symbols.length - limit} more`);
  }
  return lines.join('\n');
}

function emptyIndex(root, metadata) {
  return {
    root,
    files: [],
    symbols: [],
    imports: [],
    diagnostics: [],
    metadata: {
      cwd: root,
      scannedFiles: 0,
      indexedFiles: 0,
      maxFiles: metadata.maxFiles,
      maxBytes: metadata.maxBytes,
      maxDepth: metadata.maxDepth,
      generatedAt: new Date().toISOString()
    }
  };
}

function finalizeIndex(index) {
  index.files = index.files.slice().sort(compareFiles);
  index.symbols = sortSymbols(index.symbols);
  index.imports = sortImports(index.imports);
  index.diagnostics = sortDiagnostics(index.diagnostics);
  index.metadata.indexedFiles = index.files.length;
  return index;
}

async function walkSourceFiles({ root, directory, ignore, maxDepth, onFile }) {
  if (!(await isInsideRoot(root, directory))) return true;
  await walk(directory, 0);

  async function walk(currentDirectory, depth) {
    if (depth > maxDepth) return true;
    let entries;
    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch {
      return true;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const absolute = path.join(currentDirectory, entry.name);
      if (!(await isInsideRoot(root, absolute))) continue;
      if (entry.isDirectory()) {
        const shouldContinue = await walk(absolute, depth + 1);
        if (shouldContinue === false) return false;
      } else if (entry.isFile()) {
        const shouldContinue = await onFile(absolute);
        if (shouldContinue === false) return false;
      }
    }
    return true;
  }
}

async function readTextFile(file) {
  let buffer;
  try {
    buffer = await fs.readFile(file);
  } catch {
    return null;
  }

  if (buffer.includes(0)) return null;
  return buffer.toString('utf8');
}

function parseSourceFile({ path: filePath, language, text }) {
  if (language === 'python') return parsePythonSource({ path: filePath, text });
  return parseJavaScriptSource({ path: filePath, text, language });
}

function parseJavaScriptSource({ path: filePath, text, language }) {
  const lines = splitLines(text);
  const symbols = [];
  const imports = [];

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

    const definition = parseJavaScriptDefinitionLine(trimmed);
    if (definition) {
      symbols.push({
        path: filePath,
        line: lineNumber + 1,
        kind: definition.kind,
        name: definition.name,
        signature: trimmed,
        snippet: trimSnippet(trimmed),
        language
      });
      continue;
    }
  }

  for (const match of text.matchAll(/(^\s*import\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"][^\n;]*;?)/gm)) {
    const raw = match[1];
    const source = match[2];
    const line = lineNumberForIndex(text, match.index ?? 0);
    imports.push({
      path: filePath,
      line,
      kind: 'import',
      source,
      names: parseJavaScriptImportNames(raw),
      signature: normalizeWhitespace(raw),
      snippet: trimSnippet(normalizeWhitespace(raw)),
      language
    });
  }

  for (const match of text.matchAll(/(^\s*import\s+['"]([^'"]+)['"][^\n;]*;?)/gm)) {
    const raw = match[1];
    const source = match[2];
    const line = lineNumberForIndex(text, match.index ?? 0);
    imports.push({
      path: filePath,
      line,
      kind: 'import',
      source,
      names: [],
      signature: normalizeWhitespace(raw),
      snippet: trimSnippet(normalizeWhitespace(raw)),
      language
    });
  }

  for (const match of text.matchAll(/(^\s*export\s+\{[\s\S]*?\}\s+from\s+['"]([^'"]+)['"][^\n;]*;?)/gm)) {
    const raw = match[1];
    const source = match[2];
    const line = lineNumberForIndex(text, match.index ?? 0);
    imports.push({
      path: filePath,
      line,
      kind: 're-export',
      source,
      names: parseJavaScriptImportNames(raw.replace(/^export\s+/, '')),
      signature: normalizeWhitespace(raw),
      snippet: trimSnippet(normalizeWhitespace(raw)),
      language
    });
  }

  for (const match of text.matchAll(/(^\s*export\s+\*\s+from\s+['"]([^'"]+)['"][^\n;]*;?)/gm)) {
    const raw = match[1];
    const source = match[2];
    const line = lineNumberForIndex(text, match.index ?? 0);
    imports.push({
      path: filePath,
      line,
      kind: 're-export',
      source,
      names: ['*'],
      signature: normalizeWhitespace(raw),
      snippet: trimSnippet(normalizeWhitespace(raw)),
      language
    });
  }

  for (const match of text.matchAll(/(^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)[^\n;]*;?)/gm)) {
    const raw = match[1];
    const localName = match[2];
    const source = match[3];
    const line = lineNumberForIndex(text, match.index ?? 0);
    imports.push({
      path: filePath,
      line,
      kind: 'require',
      source,
      names: [localName],
      signature: normalizeWhitespace(raw),
      snippet: trimSnippet(normalizeWhitespace(raw)),
      language
    });
  }

  return { symbols, imports };
}

function parseJavaScriptDefinitionLine(line) {
  const functionMatch = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (functionMatch) {
    return { kind: 'function', name: functionMatch[1] };
  }

  const defaultFunctionMatch = line.match(/^export\s+default\s+function\*?(?:\s+([A-Za-z_$][\w$]*))?\s*\(/);
  if (defaultFunctionMatch) {
    return { kind: 'function', name: defaultFunctionMatch[1] || 'default' };
  }

  const classMatch = line.match(/^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
  if (classMatch) {
    return { kind: 'class', name: classMatch[1] };
  }

  const defaultClassMatch = line.match(/^export\s+default\s+class(?:\s+([A-Za-z_$][\w$]*))?/);
  if (defaultClassMatch) {
    return { kind: 'class', name: defaultClassMatch[1] || 'default' };
  }

  const interfaceMatch = line.match(/^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)\b/);
  if (interfaceMatch) {
    return { kind: 'interface', name: interfaceMatch[1] };
  }

  const typeMatch = line.match(/^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\b/);
  if (typeMatch) {
    return { kind: 'type', name: typeMatch[1] };
  }

  const enumMatch = line.match(/^(?:export\s+)?(?:declare\s+)?enum\s+([A-Za-z_$][\w$]*)\b/);
  if (enumMatch) {
    return { kind: 'enum', name: enumMatch[1] };
  }

  const classVariableMatch = line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*class\b/);
  if (classVariableMatch) {
    return { kind: 'class', name: classVariableMatch[1] };
  }

  const variableMatch = line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^=]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/);
  if (variableMatch) {
    return { kind: 'function', name: variableMatch[1] };
  }

  const methodClassMatch = line.match(/^([A-Za-z_$][\w$]*)\s*:\s*class\b/);
  if (methodClassMatch) {
    return { kind: 'class', name: methodClassMatch[1] };
  }

  const methodLikeMatch = line.match(/^([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^=]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/);
  if (methodLikeMatch) {
    return { kind: 'function', name: methodLikeMatch[1] };
  }

  return null;
}

function parseJavaScriptImportNames(raw) {
  let text = raw.replace(/^\s*import\s+/, '').replace(/^\s*export\s+\{/, '{');
  text = text.replace(/\s+from\s+['"][^'"]+['"]\s*;?$/, '');
  text = text.replace(/^\{/, '{').trim();

  const names = [];
  const namespaceMatch = text.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch) names.push(namespaceMatch[1]);

  const braceMatch = text.match(/\{([\s\S]*)\}/);
  if (braceMatch) {
    for (const part of splitCommaList(braceMatch[1])) {
      const normalizedPart = part.trim().replace(/^type\s+/, '');
      const alias = normalizedPart.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      const name = alias ? alias[1] : normalizedPart;
      if (name) names.push(name.replace(/^[{]\s*/, '').replace(/\s*[}]$/, ''));
    }
  }

  const leading = text
    .replace(/\{[\s\S]*\}/, '')
    .replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, '')
    .replace(/,\s*$/, '')
    .trim()
    .replace(/^type\s+/, '');
  if (leading && !leading.startsWith('{')) {
    for (const part of splitCommaList(leading)) {
      const cleaned = part.replace(/\s+as\s+[A-Za-z_$][\w$]*$/, '').trim();
      if (cleaned && cleaned !== 'type') names.push(cleaned);
    }
  }

  return uniqueStrings(names);
}

function parsePythonSource({ path: filePath, text }) {
  const lines = splitLines(text);
  const symbols = [];
  const imports = [];

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const defMatch = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*:/);
    if (defMatch) {
      symbols.push({
        path: filePath,
        line: lineNumber + 1,
        kind: 'function',
        name: defMatch[1],
        signature: trimmed,
        snippet: trimSnippet(trimmed),
        language: 'python'
      });
      continue;
    }

    const classMatch = trimmed.match(/^class\s+([A-Za-z_]\w*)\b(.*):/);
    if (classMatch) {
      symbols.push({
        path: filePath,
        line: lineNumber + 1,
        kind: 'class',
        name: classMatch[1],
        signature: trimmed,
        snippet: trimSnippet(trimmed),
        language: 'python'
      });
      continue;
    }

    const fromImportMatch = trimmed.match(/^from\s+([.\w]+)\s+import\s+(.+)$/);
    if (fromImportMatch) {
      imports.push({
        path: filePath,
        line: lineNumber + 1,
        kind: 'from-import',
        source: fromImportMatch[1],
        names: parsePythonImportNames(fromImportMatch[2]),
        signature: trimmed,
        snippet: trimSnippet(trimmed),
        language: 'python'
      });
      continue;
    }

    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
      imports.push({
        path: filePath,
        line: lineNumber + 1,
        kind: 'import',
        source: importMatch[1].split(/\s+as\s+/)[0].trim(),
        names: parsePythonImportNames(importMatch[1]),
        signature: trimmed,
        snippet: trimSnippet(trimmed),
        language: 'python'
      });
    }
  }

  return { symbols, imports };
}

function parsePythonImportNames(raw) {
  const cleaned = raw.replace(/[()]/g, ' ').replace(/#.*$/, '').trim();
  return uniqueStrings(
    splitCommaList(cleaned).flatMap(part => {
      const item = part.trim();
      if (!item) return [];
      const aliasMatch = item.match(/\bas\s+([A-Za-z_]\w*)$/);
      if (aliasMatch) return [aliasMatch[1]];
      return [item];
    })
  );
}

function normalizeSymbolQuery(queryOrOptions, maybeOptions) {
  const base = typeof queryOrOptions === 'string'
    ? { query: queryOrOptions }
    : { ...(queryOrOptions ?? {}) };
  const extra = maybeOptions && typeof maybeOptions === 'object' ? maybeOptions : {};
  const merged = { ...base, ...extra };
  const index = merged.index && typeof merged.index === 'object' ? merged.index : null;
  const limit = clampNumber(merged.limit, 1, 5000, 50);
  const scanOptions = {
    maxFiles: merged.maxFiles,
    maxBytes: merged.maxBytes,
    maxDepth: merged.maxDepth,
    ignore: merged.ignore
  };

  return {
    index,
    limit,
    scanOptions,
    query: typeof merged.query === 'string' ? merged.query : '',
    name: typeof merged.name === 'string' ? merged.name : '',
    kind: typeof merged.kind === 'string' ? merged.kind : '',
    path: typeof merged.path === 'string' ? merged.path : '',
    language: typeof merged.language === 'string' ? merged.language : ''
  };
}

function matchesSymbol(symbol, query) {
  if (query.name && !includesInsensitive(symbol.name, query.name)) return false;
  if (query.kind && !includesInsensitive(symbol.kind, query.kind)) return false;
  if (query.path && !includesInsensitive(symbol.path, query.path)) return false;
  if (query.language && !includesInsensitive(symbol.language, query.language)) return false;
  if (!query.query) return true;
  return [
    symbol.name,
    symbol.kind,
    symbol.path,
    symbol.signature,
    symbol.snippet
  ].some(value => includesInsensitive(value, query.query));
}

function compareFiles(a, b) {
  return compareStrings(a.path, b.path) || compareStrings(a.language, b.language);
}

function sortSymbols(symbols) {
  return symbols.slice().sort((a, b) =>
    compareStrings(a.path, b.path) ||
    compareNumbers(a.line, b.line) ||
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.name, b.name) ||
    compareStrings(a.signature, b.signature)
  );
}

function sortImports(imports) {
  return imports.slice().sort((a, b) =>
    compareStrings(a.path, b.path) ||
    compareNumbers(a.line, b.line) ||
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.source, b.source) ||
    compareStrings((a.names ?? []).join(','), (b.names ?? []).join(','))
  );
}

function sortDiagnostics(diagnostics) {
  const weight = { error: 0, warning: 1, info: 2 };
  return diagnostics.slice().sort((a, b) =>
    compareStrings(a.path ?? '', b.path ?? '') ||
    compareNumbers(weight[a.severity] ?? 99, weight[b.severity] ?? 99) ||
    compareStrings(a.message, b.message)
  );
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const rounded = Math.trunc(number);
  return Math.min(max, Math.max(min, rounded));
}

function normalizeIndexShape(index) {
  if (index && typeof index === 'object' && Array.isArray(index.files) && Array.isArray(index.symbols)) {
    return {
      root: typeof index.root === 'string' ? index.root : '',
      files: index.files,
      symbols: index.symbols,
      imports: Array.isArray(index.imports) ? index.imports : [],
      diagnostics: Array.isArray(index.diagnostics) ? index.diagnostics : [],
      metadata: index.metadata ?? {}
    };
  }

  return {
    root: '',
    files: [],
    symbols: [],
    imports: [],
    diagnostics: [],
    metadata: {}
  };
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (pythonExtensions.has(ext)) return 'python';
  if (javascriptExtensions.has(ext)) return ext === '.ts' || ext === '.mts' || ext === '.cts' || ext === '.tsx' ? 'typescript' : 'javascript';
  return null;
}

function splitLines(text) {
  return String(text).split(/\r?\n/);
}

function splitCommaList(text) {
  return String(text)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function trimSnippet(text, maxLength = 120) {
  const normalized = normalizeWhitespace(text);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function normalizeWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function includesInsensitive(value, needle) {
  return String(value ?? '').toLowerCase().includes(String(needle ?? '').toLowerCase());
}

function compareStrings(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNumbers(a, b) {
  return Number(a) - Number(b);
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function addRootDiagnostic(index, root, error) {
  const message = error?.code === 'ENOENT'
    ? `cwd does not exist: ${root}`
    : `cwd is not accessible: ${root}${error?.message ? ` (${error.message})` : ''}`;
  index.diagnostics.push({
    path: '',
    severity: 'error',
    message
  });
}

async function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toPosixPath(value) {
  return String(value).split(path.sep).join('/');
}

function toIgnoreSet(input) {
  if (input instanceof Set) return input;
  if (Array.isArray(input)) return new Set(input);
  return defaultIgnoredDirs;
}

function lineNumberForIndex(text, index) {
  return String(text.slice(0, index)).split(/\r?\n/).length;
}
