import { chatCompletion, chatCompletionStream } from './model.js';
import { askCodexCli, isCodexCliConfig } from './codexCli.js';
import { expandSelfReference } from './inputIntent.js';
import { createSystemPrompt } from './instructions.js';
import { createTools } from './tools.js';

export async function askAgent({ input, history, config, cwd, assumeYes, rl, stream = false, onToken, onStatus }) {
  const normalizedInput = expandSelfReference(input);
  await ensureSystemPrompt(history, cwd);
  if (isCodexCliConfig(config)) {
    history.push({ role: 'user', content: normalizedInput });
    const content = await askCodexCli({
      messages: history,
      config,
      cwd,
      onToken: stream ? onToken : undefined,
      onStatus
    });
    history.push({ role: 'assistant', content });
    return content;
  }

  const tools = createTools({ cwd, assumeYes, rl, config });
  const messages = history;

  messages.push({ role: 'user', content: normalizedInput });

  let usedTools = false;
  for (let turn = 0; turn < 8; turn += 1) {
    if (stream && usedTools) {
      const assistant = await chatCompletionStream({ config, messages, onToken });
      messages.push({ role: 'assistant', content: assistant.content ?? '' });
      return assistant.content ?? '';
    }

    const assistant = await chatCompletion({
      config,
      messages,
      tools: tools.schemas
    });

    messages.push({
      role: 'assistant',
      content: assistant.content ?? '',
      tool_calls: assistant.tool_calls
    });

    if (!assistant.tool_calls?.length) {
      return assistant.content ?? '';
    }

    usedTools = true;
    for (const call of assistant.tool_calls) {
      const name = call.function?.name;
      const args = parseToolArguments(call.function?.arguments);
      const result = await tools.execute(name, args).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        return `Tool error: ${message}`;
      });

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result
      });
    }
  }

  return 'Stopped after too many tool turns. Try a narrower request.';
}

async function ensureSystemPrompt(history, cwd) {
  if (history[0]?.role === 'system') return;
  history.unshift({ role: 'system', content: await createSystemPrompt(cwd) });
}

function parseToolArguments(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
