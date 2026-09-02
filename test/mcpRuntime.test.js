import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { callWorkspaceMcpTool, listWorkspaceMcpTools } from '../src/mcp/runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'fixtures', 'mock-mcp-server.js');

test('trusted user MCP configuration remains available while calls require approval', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-mcp-runtime-'));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-mcp-user-'));
  await fs.writeFile(path.join(configDir, 'mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [fixture] }
    }
  }));

  const approvals = [];
  const report = await listWorkspaceMcpTools(cwd, {
    configDir,
    approve: async approval => approvals.push(approval)
  });
  assert.equal(report.entries[0].name, 'mock');
  assert.deepEqual(approvals, []);

  const result = await callWorkspaceMcpTool({
    cwd,
    serverName: 'mock',
    toolName: 'echo',
    args: { text: 'trusted' },
    configDir,
    approve: async approval => approvals.push(approval)
  });

  assert.equal(result.content[0].text, 'echo:trusted');
  assert.deepEqual(approvals.map(approval => approval.type), ['tool-call']);
});
