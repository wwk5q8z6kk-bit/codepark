#!/usr/bin/env node
import { stdin, stdout } from 'node:process';

let buffer = '';
stdin.setEncoding('utf8');
stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (line.trim()) handleMessage(JSON.parse(line));
  }
});

function handleMessage(message) {
  if (message.method === 'initialize') {
    respond(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-mcp', version: '1.0.0' }
    });
    return;
  }

  if (message.method === 'notifications/initialized') return;

  if (message.method === 'tools/list') {
    respond(message.id, {
      tools: [
        {
          name: 'echo',
          description: 'Echo a text value.',
          inputSchema: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string' }
            }
          }
        }
      ]
    });
    return;
  }

  if (message.method === 'tools/call') {
    const isEnvironmentTool = message.params?.name === 'environment';
    respond(message.id, {
      content: [
        {
          type: 'text',
          text: isEnvironmentTool
            ? `secret:${process.env.CODEPARK_API_KEY ?? ''};explicit:${process.env.MCP_EXPLICIT ?? ''}`
            : `echo:${message.params?.arguments?.text ?? ''}`
        }
      ]
    });
    return;
  }

  respondError(message.id, -32601, `unknown method: ${message.method}`);
}

function respond(id, result) {
  stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function respondError(id, code, message) {
  stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}
