const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_KEEP_MESSAGES = 8;
const MAX_SUMMARY_LINES = 24;
const SUMMARY_SNIPPET_CHARS = 160;

export function estimateTextTokens(value) {
  const text = String(value ?? '');
  if (!text) return 0;
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message) {
  if (!message) return 0;
  let total = 4 + estimateTextTokens(message.role ?? '');
  total += estimateTextTokens(serializeContent(message.content));
  if (message.name) total += estimateTextTokens(message.name);
  if (message.tool_call_id) total += estimateTextTokens(message.tool_call_id);
  if (message.tool_calls) total += estimateTextTokens(JSON.stringify(message.tool_calls));
  return total;
}

export function estimateMessagesTokens(messages = []) {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export function compactHistoryIfNeeded({ messages, maxTokens, keepMessages = DEFAULT_KEEP_MESSAGES }) {
  const beforeTokens = estimateMessagesTokens(messages);
  if (!Number.isFinite(maxTokens) || beforeTokens <= maxTokens) {
    return { compacted: false, messages, beforeTokens, afterTokens: beforeTokens };
  }
  return compactHistory({ messages, keepMessages });
}

export function compactHistory({ messages, keepMessages = DEFAULT_KEEP_MESSAGES }) {
  const beforeTokens = estimateMessagesTokens(messages);
  const leadingSystem = [];
  let index = 0;
  while (messages[index]?.role === 'system') {
    leadingSystem.push(messages[index]);
    index += 1;
  }

  const conversation = messages.slice(index);
  if (conversation.length < 2) {
    return { compacted: false, messages, beforeTokens, afterTokens: beforeTokens };
  }

  const keepCount = Math.max(1, Math.min(normalizeKeepMessages(keepMessages), conversation.length - 1));
  const older = conversation.slice(0, -keepCount);
  const recent = conversation.slice(-keepCount);
  if (!older.length) {
    return { compacted: false, messages, beforeTokens, afterTokens: beforeTokens };
  }

  const summary = createSummaryMessage(older);
  const compactedMessages = [...leadingSystem, summary, ...recent];
  const afterTokens = estimateMessagesTokens(compactedMessages);
  if (afterTokens >= beforeTokens) {
    return { compacted: false, messages, beforeTokens, afterTokens: beforeTokens };
  }
  return {
    compacted: true,
    messages: compactedMessages,
    beforeTokens,
    afterTokens
  };
}

export function formatTokenBudget({ messages, limit, threshold }) {
  const estimated = estimateMessagesTokens(messages);
  const resolvedLimit = Number(limit) || 0;
  const resolvedThreshold = Number(threshold) || 0;
  const usage = resolvedLimit > 0 ? `${Math.round((estimated / resolvedLimit) * 100)}%` : 'n/a';
  const thresholdText = resolvedThreshold > 0 ? String(resolvedThreshold) : 'disabled';
  const status = resolvedThreshold > 0 && estimated >= resolvedThreshold ? 'auto-compaction due' : 'ok';

  return [
    `Estimated tokens: ${estimated}`,
    `Context limit: ${resolvedLimit || 'unknown'}`,
    `Auto-compact threshold: ${thresholdText}`,
    `Usage: ${usage}`,
    `Messages: ${messages.length}`,
    `Status: ${status}`
  ].join('\n');
}

function createSummaryMessage(messages) {
  const shown = messages.slice(-MAX_SUMMARY_LINES);
  const omitted = Math.max(0, messages.length - shown.length);
  const lines = ['Conversation summary before compaction:'];
  if (omitted) lines.push(`- ${omitted} older message(s) omitted from this local summary.`);
  for (const message of shown) {
    lines.push(`- ${String(message.role ?? 'message').toUpperCase()}: ${snippet(serializeContent(message.content))}`);
  }
  return {
    role: 'system',
    content: lines.join('\n')
  };
}

function serializeContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return JSON.stringify(content);
}

function snippet(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= SUMMARY_SNIPPET_CHARS) return text;
  return `${text.slice(0, SUMMARY_SNIPPET_CHARS - 3)}...`;
}

function normalizeKeepMessages(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_KEEP_MESSAGES;
  return Math.max(1, Math.floor(number));
}
