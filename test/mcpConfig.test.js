import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadMcpConfig, normalizeMcpConfig } from '../src/mcp/config.js';

test('normalizeMcpConfig accepts empty config', () => {
  assert.deepEqual(normalizeMcpConfig({}), { servers: {} });
});

test('normalizeMcpConfig preserves servers', () => {
  const config = normalizeMcpConfig({ servers: { local: { command: 'node', args: ['server.js'] } } });
  assert.equal(config.servers.local.command, 'node');
});

test('normalizeMcpConfig rejects servers without commands', () => {
  assert.throws(
    () => normalizeMcpConfig({ servers: { local: { args: ['server.js'] } } }),
    /MCP server command is required/
  );
});

test('normalizeMcpConfig normalizes optional server fields', () => {
  const config = normalizeMcpConfig({
    servers: {
      local: {
        command: 'node',
        args: ['server.js', 42],
        env: { PORT: 3000 },
        cwd: 'tools'
      }
    }
  });

  assert.deepEqual(config.servers.local, {
    command: 'node',
    args: ['server.js', '42'],
    cwd: 'tools',
    env: { PORT: '3000' }
  });
});

test('loadMcpConfig gives trusted user servers precedence over workspace servers', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-mcp-workspace-'));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-mcp-user-'));
  await fs.writeFile(path.join(cwd, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      workspace: { command: 'workspace-server' },
      shared: { command: 'workspace-shared' }
    }
  }));
  await fs.writeFile(path.join(configDir, 'mcp.json'), JSON.stringify({
    servers: {
      user: { command: 'user-server' },
      shared: { command: 'user-shared' }
    }
  }));

  const loaded = await loadMcpConfig(cwd, { configDir });

  assert.equal(loaded.config.servers.workspace.command, 'workspace-server');
  assert.equal(loaded.config.servers.user.command, 'user-server');
  assert.equal(loaded.config.servers.shared.command, 'user-shared');
  assert.equal(loaded.serverSources.workspace.trusted, false);
  assert.equal(loaded.serverSources.user.trusted, true);
  assert.equal(loaded.serverSources.shared.file, path.join(configDir, 'mcp.json'));
});
