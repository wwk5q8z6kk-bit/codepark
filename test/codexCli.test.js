import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { askCodexCli, formatMessagesForCodex, isCodexCliConfig } from '../src/codexCli.js';

test('isCodexCliConfig detects codex provider', () => {
  assert.equal(isCodexCliConfig({ provider: 'codex', baseUrl: '' }), true);
  assert.equal(isCodexCliConfig({ provider: '', baseUrl: 'codex://cli' }), true);
  assert.equal(isCodexCliConfig({ provider: '', baseUrl: 'codex://local-session' }), true);
  assert.equal(isCodexCliConfig({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }), false);
});

test('formatMessagesForCodex includes role labels and text content', () => {
  const prompt = formatMessagesForCodex([
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Say hello.' },
    { role: 'assistant', content: '' }
  ]);
  assert.match(prompt, /SYSTEM:\nBe concise\./);
  assert.match(prompt, /USER:\nSay hello\./);
  assert.match(prompt, /model backend for CodePark/);
  assert.doesNotMatch(prompt, /ASSISTANT/);
});

test('askCodexCli reports progress while the child process is running', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-codex-test-'));
  const fakeCodexPath = path.join(tempDir, 'codex');
  const originalPath = process.env.PATH;
  const statuses = [];

  await fs.writeFile(
    fakeCodexPath,
    `#!/usr/bin/env node
const fs = require('node:fs/promises');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const outputIndex = process.argv.indexOf('--output-last-message');
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
    console.error('missing --output-last-message');
    process.exit(2);
  }

  await delay(70);
  await fs.writeFile(process.argv[outputIndex + 1], 'final from fake codex\\n');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
`,
    { mode: 0o755 }
  );

  process.env.PATH = `${tempDir}${path.delimiter}${originalPath ?? ''}`;
  try {
    const content = await askCodexCli({
      messages: [{ role: 'user', content: 'Summarize this project.' }],
      config: { provider: 'codex', model: 'codex-cli-default' },
      cwd: tempDir,
      onStatus: status => statuses.push(status),
      progressIntervalMs: 10
    });

    assert.equal(content, 'final from fake codex');
    assert.ok(statuses.length >= 1);
    assert.match(statuses.at(-1), /Codex CLI.+elapsed/);
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('askCodexCli uses read-only sandbox and sanitized env in secure mode', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-codex-secure-'));
  const fakeCodexPath = path.join(tempDir, 'codex');
  const recordPath = path.join(tempDir, 'record.json');
  const originalPath = process.env.PATH;
  const originalCodeParkKey = process.env.CODEPARK_API_KEY;

  await fs.writeFile(
    fakeCodexPath,
    `#!/usr/bin/env node
const fs = require('node:fs/promises');

(async () => {
  const outputIndex = process.argv.indexOf('--output-last-message');
  await fs.writeFile(process.env.CODEPARK_TEST_RECORD, JSON.stringify({
    args: process.argv.slice(2),
    codeparkApiKey: process.env.CODEPARK_API_KEY || ''
  }));
  await fs.writeFile(process.argv[outputIndex + 1], 'secure final\\n');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
`,
    { mode: 0o755 }
  );

  process.env.PATH = `${tempDir}${path.delimiter}${originalPath ?? ''}`;
  process.env.CODEPARK_API_KEY = 'sk-should-not-leak';
  process.env.CODEPARK_TEST_RECORD = recordPath;
  try {
    const content = await askCodexCli({
      messages: [{ role: 'user', content: 'Summarize this project.' }],
      config: { provider: 'codex', model: 'codex-cli-default', secureMode: true },
      cwd: tempDir,
      progressIntervalMs: 0
    });
    const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
    const sandboxIndex = record.args.indexOf('--sandbox');

    assert.equal(content, 'secure final');
    assert.equal(record.args[sandboxIndex + 1], 'read-only');
    assert.equal(record.codeparkApiKey, '');
  } finally {
    process.env.PATH = originalPath;
    if (originalCodeParkKey === undefined) delete process.env.CODEPARK_API_KEY;
    else process.env.CODEPARK_API_KEY = originalCodeParkKey;
    delete process.env.CODEPARK_TEST_RECORD;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
