import { loadMcpConfig } from './config.js';
import { withMcpClient } from './client.js';
import { isSecretEnvName } from '../env.js';

export async function listWorkspaceMcpTools(cwd, options = {}) {
  const loaded = await loadMcpConfig(cwd, options);
  const entries = [];
  for (const [name, server] of Object.entries(loaded.config.servers)) {
    await approveMcpServer(loaded, name, server, options);
    try {
      const tools = await withMcpClient({ name, server, cwd }, client => client.listTools());
      entries.push({ name, tools });
    } catch (error) {
      entries.push({ name, error: error instanceof Error ? error.message : String(error), tools: [] });
    }
  }
  return { ...loaded, entries };
}

export async function callWorkspaceMcpTool({ cwd, serverName, toolName, args, ...options }) {
  const loaded = await loadMcpConfig(cwd, options);
  const server = loaded.config.servers[serverName];
  if (!server) throw new Error(`MCP server not found: ${serverName}`);
  await approveMcpServer(loaded, serverName, server, options);
  await approveMcpToolCall(serverName, toolName, args, options);
  return withMcpClient({ name: serverName, server, cwd }, client => client.callTool(toolName, args));
}

export function formatWorkspaceMcpTools(report) {
  if (!report.exists) return `No MCP config found at ${report.file}`;
  if (!report.entries.length) return `MCP config found at ${report.file}\nNo servers configured.`;

  const configuredFiles = (report.sources ?? []).filter(source => source.exists).map(source => source.file);
  const lines = [
    configuredFiles.length > 1
      ? `MCP configs found at ${configuredFiles.join(', ')}`
      : `MCP config found at ${configuredFiles[0] ?? report.file}`
  ];
  for (const entry of report.entries) {
    lines.push(`- ${entry.name}`);
    if (entry.error) {
      lines.push(`  error: ${entry.error}`);
      continue;
    }
    if (!entry.tools.length) {
      lines.push('  no tools');
      continue;
    }
    for (const tool of entry.tools) {
      lines.push(`  ${tool.name}${tool.description ? ` - ${tool.description}` : ''}`);
    }
  }
  return lines.join('\n');
}

export function formatMcpToolCallResult(result) {
  if (Array.isArray(result?.content)) {
    const text = result.content
      .map(part => {
        if (part?.type === 'text') return part.text ?? '';
        return JSON.stringify(part);
      })
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return JSON.stringify(result, null, 2);
}

export function formatMcpApproval(approval) {
  if (approval.type === 'server') {
    const command = [approval.server.command, ...approval.server.args].map(formatValue).join(' ');
    const workingDirectory = approval.server.cwd ? `\nWorking directory: ${formatValue(approval.server.cwd)}` : '';
    const envEntries = Object.entries(approval.server.env ?? {});
    const environment = envEntries.length
      ? `\nConfigured environment: ${envEntries.map(formatEnvironmentEntry).join(', ')}`
      : '';
    return [
      `Launch untrusted workspace MCP server ${formatValue(approval.serverName)}?`,
      `Configuration: ${formatValue(approval.file)}`,
      `Command: ${command}${workingDirectory}${environment}`
    ].join('\n');
  }

  return [
    `Call MCP tool ${formatValue(`${approval.serverName}.${approval.toolName}`)}?`,
    `Arguments: ${formatJson(approval.args)}`
  ].join('\n');
}

async function approveMcpServer(loaded, serverName, server, options) {
  const source = loaded.serverSources[serverName];
  if (source?.trusted) return;
  if (typeof options.approve !== 'function') {
    throw new Error(`MCP server "${serverName}" from workspace config requires explicit user approval`);
  }
  await options.approve({
    type: 'server',
    file: source?.file ?? loaded.file,
    serverName,
    server
  });
}

async function approveMcpToolCall(serverName, toolName, args, options) {
  if (typeof options.approve !== 'function') {
    throw new Error(`MCP tool call "${serverName}.${toolName}" requires explicit user approval`);
  }
  await options.approve({ type: 'tool-call', serverName, toolName, args });
}

function formatValue(value) {
  const text = JSON.stringify(String(value));
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

function formatJson(value) {
  let text;
  try {
    text = JSON.stringify(value ?? {}) ?? '"[unserializable arguments]"';
  } catch {
    text = '"[unserializable arguments]"';
  }
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

function formatEnvironmentEntry([name, value]) {
  return `${formatValue(name)}=${isSecretEnvName(name) ? '"[redacted]"' : formatValue(value)}`;
}
