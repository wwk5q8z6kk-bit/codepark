import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactHistory,
  compactHistoryIfNeeded,
  estimateMessagesTokens,
  estimateTextTokens,
  formatTokenBudget
} from '../src/context.js';

test('estimateTextTokens gives a stable local estimate', () => {
  assert.equal(estimateTextTokens('abcd'), 1);
  assert.equal(estimateTextTokens('abcde'), 2);
  assert.equal(estimateTextTokens(''), 0);
});

test('estimateMessagesTokens counts message content and metadata', () => {
  const total = estimateMessagesTokens([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'world' }
  ]);

  assert.ok(total >= 4);
});

test('compactHistory preserves the system prompt and recent messages', () => {
  const messages = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'old user context '.repeat(30) },
    { role: 'assistant', content: 'old assistant context '.repeat(30) },
    { role: 'user', content: 'recent user' },
    { role: 'assistant', content: 'recent assistant' }
  ];

  const result = compactHistory({ messages, keepMessages: 2 });

  assert.equal(result.compacted, true);
  assert.equal(result.messages[0].content, 'system prompt');
  assert.match(result.messages[1].content, /Conversation summary before compaction/);
  assert.match(result.messages[1].content, /old user context/);
  assert.deepEqual(result.messages.slice(-2), messages.slice(-2));
  assert.ok(result.afterTokens < result.beforeTokens);
});

test('compactHistoryIfNeeded leaves history unchanged below the threshold', () => {
  const messages = [{ role: 'user', content: 'short' }];
  const result = compactHistoryIfNeeded({ messages, maxTokens: 1000 });

  assert.equal(result.compacted, false);
  assert.equal(result.messages, messages);
  assert.equal(result.beforeTokens, result.afterTokens);
});

test('compactHistory does not replace history when the summary would be larger', () => {
  const messages = [
    { role: 'user', content: 'short' },
    { role: 'assistant', content: 'also short' }
  ];

  const result = compactHistory({ messages, keepMessages: 1 });

  assert.equal(result.compacted, false);
  assert.equal(result.messages, messages);
});

test('compactHistoryIfNeeded compacts history above the threshold', () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index} ${'context '.repeat(80)}`
  }));

  const result = compactHistoryIfNeeded({ messages, maxTokens: 80, keepMessages: 4 });

  assert.equal(result.compacted, true);
  assert.equal(result.messages.at(-1).content, messages.at(-1).content);
  assert.ok(result.afterTokens < result.beforeTokens);
});

test('formatTokenBudget reports usage and thresholds', () => {
  const output = formatTokenBudget({
    messages: [{ role: 'user', content: 'hello world' }],
    limit: 100,
    threshold: 75
  });

  assert.match(output, /Estimated tokens:/);
  assert.match(output, /Context limit: 100/);
  assert.match(output, /Auto-compact threshold: 75/);
  assert.match(output, /Messages: 1/);
});
