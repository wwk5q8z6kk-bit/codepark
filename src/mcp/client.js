import path from 'node:path';
import { spawn } from 'node:child_process';

const protocolVersion = '2024-11-05';
const defaultTimeoutMs = 10000;
const posixEnvNames = ['PATH', 'HOME', 'TMPDIR'];
const windowsEnvNames = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP'
];

export class McpClient {
  constructor({ name, server, cwd, timeoutMs = defaultTimeoutMs }) {
    this.name = name;
    this.server = normalizeServerConfig(server);
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.stderr = '';
  }

  async start() {
    if (this.child) return;
    this.child = spawn(this.server.command, this.server.args, {
      cwd: resolveServerCwd(this.cwd, this.server.cwd),
      env: createMcpSubprocessEnv(process.env, this.server.env),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.handleStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => {
      this.stderr += chunk;
    });
    this.child.on('error', error => this.rejectAll(error));
    this.child.on('close', code => {
      this.rejectAll(new Error(`MCP server ${this.name} exited with code ${code ?? 1}`));
    });

    await this.request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'codepark', version: '0.1.0' }
    });
    this.notify('notifications/initialized', {});
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const result = await this.request('tools/list', cursor ? { cursor } : {});
      tools.push(...(result.tools ?? []));
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }

  close() {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
  }

  request(method, params) {
    if (!this.child?.stdin?.writable) {
      throw new Error(`MCP server ${this.name} is not running`);
    }

    const id = this.nextId;
    this.nextId += 1;
    const payload = { jsonrpc: '2.0', id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${this.name}.${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  notify(method, params) {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? `MCP request failed: ${message.id}`));
    } else {
      pending.resolve(message.result ?? {});
    }
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export async function withMcpClient(options, callback) {
  const client = new McpClient(options);
  await client.start();
  try {
    return await callback(client);
  } finally {
    client.close();
  }
}

export function createMcpSubprocessEnv(baseEnv = process.env, serverEnv = {}) {
  const env = {};
  const names = process.platform === 'win32' ? windowsEnvNames : posixEnvNames;
  for (const name of names) {
    const entry = findEnvironmentEntry(baseEnv, name);
    if (entry && entry[1] != null) env[entry[0]] = String(entry[1]);
  }
  for (const [key, value] of Object.entries(serverEnv || {})) {
    if (value != null) env[key] = String(value);
  }
  return env;
}

function normalizeServerConfig(server) {
  if (!server || typeof server !== 'object') throw new Error('MCP server config must be an object');
  if (!server.command || typeof server.command !== 'string') throw new Error('MCP server command is required');
  return {
    command: server.command,
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    cwd: server.cwd,
    env: normalizeEnv(server.env)
  };
}

function normalizeEnv(env) {
  if (!env || typeof env !== 'object') return {};
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]));
}

function findEnvironmentEntry(env, name) {
  const expected = name.toUpperCase();
  return Object.entries(env || {}).find(([key]) => key.toUpperCase() === expected);
}

function resolveServerCwd(workspaceCwd, serverCwd) {
  if (!serverCwd) return workspaceCwd;
  return path.isAbsolute(serverCwd) ? serverCwd : path.resolve(workspaceCwd, serverCwd);
}
