import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from '../config.js';

export function normalizeMcpConfig(config) {
  return {
    servers: normalizeServers(config?.servers)
  };
}

export async function loadWorkspaceMcpConfig(cwd) {
  return loadMcpConfigFile(path.join(cwd, '.codepark.mcp.json'), {
    source: 'workspace',
    trusted: false
  });
}

export async function loadMcpConfig(cwd, options = {}) {
  const [workspace, user] = await Promise.all([
    loadWorkspaceMcpConfig(cwd),
    loadUserMcpConfig(options)
  ]);
  const serverSources = Object.create(null);
  for (const name of Object.keys(workspace.config.servers)) {
    serverSources[name] = { file: workspace.file, source: workspace.source, trusted: false };
  }
  for (const name of Object.keys(user.config.servers)) {
    serverSources[name] = { file: user.file, source: user.source, trusted: true };
  }

  return {
    file: workspace.file,
    config: {
      servers: { ...workspace.config.servers, ...user.config.servers }
    },
    exists: workspace.exists || user.exists,
    sources: [workspace, user],
    serverSources
  };
}

export async function loadUserMcpConfig(options = {}) {
  const file = options.userConfigFile
    ?? path.join(options.configDir ?? getConfigDir(), 'mcp.json');
  return loadMcpConfigFile(file, { source: 'user', trusted: true });
}

async function loadMcpConfigFile(file, { source, trusted }) {
  const text = await fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (text === null) {
    return { file, config: normalizeMcpConfig({}), exists: false, source, trusted };
  }
  return { file, config: normalizeMcpConfig(JSON.parse(text)), exists: true, source, trusted };
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
