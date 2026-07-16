import { loadWorkspaceMcpConfig } from './config.js';
import { withMcpClient } from './client.js';

export async function listWorkspaceMcpTools(cwd) {
  const loaded = await loadWorkspaceMcpConfig(cwd);
  const entries = [];
  for (const [name, server] of Object.entries(loaded.config.servers)) {
    try {
      const tools = await withMcpClient({ name, server, cwd }, client => client.listTools());
      entries.push({ name, tools });
    } catch (error) {
      entries.push({ name, error: error instanceof Error ? error.message : String(error), tools: [] });
    }
  }
  return { ...loaded, entries };
}

export async function callWorkspaceMcpTool({ cwd, serverName, toolName, args }) {
  const loaded = await loadWorkspaceMcpConfig(cwd);
  const server = loaded.config.servers[serverName];
  if (!server) throw new Error(`MCP server not found: ${serverName}`);
  return withMcpClient({ name: serverName, server, cwd }, client => client.callTool(toolName, args));
}

export function formatWorkspaceMcpTools(report) {
  if (!report.exists) return `No MCP config found at ${report.file}`;
  if (!report.entries.length) return `MCP config found at ${report.file}\nNo servers configured.`;

  const lines = [`MCP config found at ${report.file}`];
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
