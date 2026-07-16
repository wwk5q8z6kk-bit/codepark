import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withMcpClient } from '../src/mcp/client.js';

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
