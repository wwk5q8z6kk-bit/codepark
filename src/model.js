import { isLocalBaseUrl } from './config.js';

export async function chatCompletion({ config, messages, tools }) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const headers = {
    'content-type': 'application/json'
  };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  } else if (!isLocalBaseUrl(baseUrl)) {
    throw new Error('No API key configured. Use /setup or /key in interactive mode, or run `codepark setup`.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2
      })
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`model request failed (${response.status}): ${trim(text, 800)}`);
    }

    const data = JSON.parse(text);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('model response did not include a message');
    return message;
  } finally {
    clearTimeout(timeout);
  }
}

export async function chatCompletionStream({ config, messages, onToken }) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const headers = {
    'content-type': 'application/json'
  };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  } else if (!isLocalBaseUrl(baseUrl)) {
    throw new Error('No API key configured. Use /setup or /key in interactive mode, or run `codepark setup`.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`model request failed (${response.status}): ${trim(text, 800)}`);
    }
    if (!response.body) throw new Error('streaming response did not include a body');

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split(/\n\n+/);
      buffer = blocks.pop() ?? '';
      content += emitStreamPayloads(blocks.join('\n\n'), onToken);
    }

    buffer += decoder.decode();
    content += emitStreamPayloads(buffer, onToken);
    return { role: 'assistant', content };
  } finally {
    clearTimeout(timeout);
  }
}

function emitStreamPayloads(text, onToken) {
  let content = '';
  for (const payload of parseSsePayloads(text)) {
    if (payload === '[DONE]') break;
    const data = JSON.parse(payload);
    const token = data.choices?.[0]?.delta?.content ?? '';
    if (token) {
      content += token;
      onToken?.(token);
    }
  }
  return content;
}

function parseSsePayloads(text) {
  return text
    .split(/\n\n+/)
    .map(block => block.split('\n').find(line => line.startsWith('data: ')))
    .filter(Boolean)
    .map(line => line.slice('data: '.length).trim());
}

function trim(value, max) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
