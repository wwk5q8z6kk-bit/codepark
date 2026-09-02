import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMcpSubprocessEnv, withMcpClient } from '../src/mcp/client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'fixtures', 'mock-mcp-server.js');

test('withMcpClient initializes a stdio server and lists tools', async () => {
  const tools = await withMcpClient({
    name: 'mock',
    server: { command: process.execPath, args: [fixture] },
    cwd: root
  }, client => client.listTools());

  assert.equal(tools[0].name, 'echo');
  assert.match(tools[0].description, /Echo/);
});

test('withMcpClient calls a stdio server tool', async () => {
  const result = await withMcpClient({
    name: 'mock',
    server: { command: process.execPath, args: [fixture] },
    cwd: root
  }, client => client.callTool('echo', { text: 'hello' }));

  assert.equal(result.content[0].text, 'echo:hello');
});

test('createMcpSubprocessEnv keeps only runtime and explicit server variables', () => {
  const env = createMcpSubprocessEnv({
    PATH: '/bin',
    HOME: '/home/codepark',
    TMPDIR: '/private/tmp',
    CODEPARK_API_KEY: 'secret',
    OPENAI_API_KEY: 'secret',
    LANG: 'en_US.UTF-8'
  }, { MCP_EXPLICIT: 'allowed' });

  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/home/codepark');
  assert.equal(env.MCP_EXPLICIT, 'allowed');
  assert.equal(env.CODEPARK_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.LANG, undefined);
  if (process.platform !== 'win32') assert.equal(env.TMPDIR, '/private/tmp');
});

test('withMcpClient does not expose inherited secrets to a server', async () => {
  const previous = process.env.CODEPARK_API_KEY;
  process.env.CODEPARK_API_KEY = 'parent-secret';
  try {
    const result = await withMcpClient({
      name: 'mock',
      server: {
        command: process.execPath,
        args: [fixture],
        env: { MCP_EXPLICIT: 'allowed' }
      },
      cwd: root
    }, client => client.callTool('environment'));

    assert.equal(result.content[0].text, 'secret:;explicit:allowed');
  } finally {
    if (previous === undefined) delete process.env.CODEPARK_API_KEY;
    else process.env.CODEPARK_API_KEY = previous;
  }
});
