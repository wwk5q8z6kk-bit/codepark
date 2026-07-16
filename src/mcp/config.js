import fs from 'node:fs/promises';
import path from 'node:path';

export function normalizeMcpConfig(config) {
  return {
    servers: normalizeServers(config?.servers)
  };
}

export async function loadWorkspaceMcpConfig(cwd) {
  const file = path.join(cwd, '.codepark.mcp.json');
  const text = await fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (text === null) return { file, config: normalizeMcpConfig({}), exists: false };
  return { file, config: normalizeMcpConfig(JSON.parse(text)), exists: true };
}

export function formatMcpConfig({ file, config, exists }) {
  const names = Object.keys(config.servers);
  if (!exists) return `No MCP config found at ${file}`;
  if (!names.length) return `MCP config found at ${file}\nNo servers configured.`;
  return [`MCP config found at ${file}`, ...names.map(name => `- ${name}`)].join('\n');
}

function normalizeServers(servers) {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [name, normalizeServer(name, server)])
  );
}

function normalizeServer(name, server) {
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    throw new Error(`MCP server config must be an object: ${name}`);
  }
  const command = String(server.command ?? '').trim();
  if (!command) throw new Error(`MCP server command is required: ${name}`);
  return {
    command,
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    ...(server.cwd ? { cwd: String(server.cwd) } : {}),
    env: normalizeEnv(server.env)
  };
}

function normalizeEnv(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]));
}
