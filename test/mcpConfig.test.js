import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMcpConfig } from '../src/mcp/config.js';

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
