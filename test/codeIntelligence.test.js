import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodeIndex, findCodeSymbols, formatCodeIndex, formatCodeSymbolResults } from '../src/codeIntelligence.js';

test('createCodeIndex indexes js, ts, and python symbols and imports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-code-intel-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true });

  await fs.writeFile(path.join(root, 'src', 'alpha.js'), [
    "import fs from 'node:fs';",
    "import { readFile as readText } from './beta.js';",
    '',
    'export function loadConfig(name) {',
    '  return readText(name) + fs.existsSync(name);',
    '}',
    '',
    'export const buildIndex = () => loadConfig("x");',
    '',
    'class ProjectIndex {}',
    ''
  ].join('\n'));

  await fs.writeFile(path.join(root, 'src', 'beta.ts'), [
    "export type Entry = { name: string };",
    '',
    'export interface Options {',
    '  limit: number;',
    '}',
    '',
    'export const parseEntry = (entry: Entry) => entry;',
    ''
  ].join('\n'));

  await fs.writeFile(path.join(root, 'src', 'gamma.py'), [
    'import os',
    'from collections import defaultdict as dd',
    '',
    'def build_index(root, limit=10):',
    '    return root',
    '',
    'class Parser:',
    '    pass',
    ''
  ].join('\n'));

  await fs.writeFile(path.join(root, 'node_modules', 'ignored', 'skip.js'), 'export function skip() {}\n');

  const index = await createCodeIndex(root, { maxFiles: 20, maxBytes: 4096 });

  assert.deepEqual(index.files.map(file => file.path), ['src/alpha.js', 'src/beta.ts', 'src/gamma.py']);
  assert.deepEqual(index.symbols.map(symbol => `${symbol.path}:${symbol.line}:${symbol.kind}:${symbol.name}`), [
    'src/alpha.js:4:function:loadConfig',
    'src/alpha.js:8:function:buildIndex',
    'src/alpha.js:10:class:ProjectIndex',
    'src/beta.ts:1:type:Entry',
    'src/beta.ts:3:interface:Options',
    'src/beta.ts:7:function:parseEntry',
    'src/gamma.py:4:function:build_index',
    'src/gamma.py:7:class:Parser'
  ]);
  assert.deepEqual(index.imports.map(entry => `${entry.path}:${entry.line}:${entry.kind}:${entry.source}`), [
    'src/alpha.js:1:import:node:fs',
    'src/alpha.js:2:import:./beta.js',
    'src/gamma.py:1:import:os',
    'src/gamma.py:2:from-import:collections'
  ]);
  assert.equal(index.diagnostics.length, 0);
  assert.equal(index.metadata.indexedFiles, 3);
  assert.equal(index.metadata.scannedFiles, 3);
});

test('findCodeSymbols filters by name, kind, and path and stays deterministic', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-code-intel-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'alpha.js'), [
    'export function loadConfig() {}',
    'export const buildIndex = () => {}',
    'class ProjectIndex {}',
    ''
  ].join('\n'));
  await fs.writeFile(path.join(root, 'src', 'beta.py'), [
    'def build_index():',
    '    return True',
    ''
  ].join('\n'));

  const byName = await findCodeSymbols(root, 'build');
  assert.deepEqual(byName.map(symbol => symbol.name), ['buildIndex', 'build_index']);

  const byKindAndPath = await findCodeSymbols(root, { kind: 'class', path: 'src/alpha.js' });
  assert.deepEqual(byKindAndPath.map(symbol => `${symbol.path}:${symbol.name}`), ['src/alpha.js:ProjectIndex']);

  const noMatch = await findCodeSymbols(root, { name: 'missing' });
  assert.deepEqual(noMatch, []);
});

test('formatCodeIndex and formatCodeSymbolResults produce compact summaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-code-intel-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'alpha.js'), 'export function loadConfig() {}\n');
  const index = await createCodeIndex(root);

  const summary = formatCodeIndex(index);
  assert.match(summary, /files: 1/);
  assert.match(summary, /symbols: 1/);
  assert.match(summary, /imports: 0/);
  assert.match(summary, /src\/alpha\.js/);

  const symbols = formatCodeSymbolResults(index.symbols);
  assert.match(symbols, /src\/alpha\.js:1 function loadConfig/);
  assert.match(formatCodeSymbolResults([]), /No code symbols found/);
});

test('createCodeIndex handles missing cwd and bounded scans gracefully', async () => {
  const missing = path.join(os.tmpdir(), `codepark-missing-${Date.now()}`);
  const missingIndex = await createCodeIndex(missing);
  assert.deepEqual(missingIndex.files, []);
  assert.match(missingIndex.diagnostics[0].message, /does not exist|not accessible/i);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-code-intel-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'one.js'), 'export function one() {}\n');
  await fs.writeFile(path.join(root, 'src', 'two.js'), 'export function two() {}\n');
  await fs.writeFile(path.join(root, 'src', 'three.js'), 'export function three() {}\n');

  const limited = await createCodeIndex(root, { maxFiles: 2, maxBytes: 64 });
  assert.equal(limited.files.length, 2);
  assert.match(limited.diagnostics.map(entry => entry.message).join('\n'), /maxFiles/i);
});
