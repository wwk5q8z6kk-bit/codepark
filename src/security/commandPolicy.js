import { parseShellWords } from '../shellSyntax.js';
import { isWindows } from '../platform.js';

const dangerousCommands = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'curl',
  'wget',
  'nc',
  'netcat',
  'mkfs',
  'dd',
  'shutdown',
  'reboot'
]);

export function evaluateCommandPolicy(command) {
  if (!command || !command.trim()) return 'allowedWithPermission';
  const lines = command.trim().split(/\r?\n|\r/).filter(Boolean);
  let policy = 'allowedWithPermission';
  for (const line of lines) {
    const linePolicy = evaluateLine(line);
    if (linePolicy === 'disabled') return 'disabled';
    policy = mostRestrictive(policy, linePolicy);
  }
  return policy;
}

function evaluateLine(line) {
  if (/rm\s+-rf\s+\/(?:\s|$)/.test(line)) return 'disabled';
  if (/\b(?:mkfs|shutdown|reboot)\b/.test(line)) return 'disabled';
  if (/\bdd\s+if=/.test(line)) return 'disabled';
  if (/>+\s*\/dev\/(?:sd|disk)/.test(line)) return 'disabled';
  if (/:\(\)\s*\{\s*:\|:/.test(line)) return 'disabled';
  if (/\$[\w{]/.test(line)) return 'allowedWithPermission';

  let current = [];
  for (const token of parseShellWords(line)) {
    if (isOperator(token)) {
      const policy = evaluateCommandTokens(current);
      if (policy === 'disabled') return 'disabled';
      current = [];
      continue;
    }
    if (typeof token === 'string') current.push(token);
  }
  return evaluateCommandTokens(current);
}

function evaluateCommandTokens(tokens) {
  const command = tokens[0];
  if (!command) return 'allowedWithPermission';
  if (dangerousCommands.has(pathBasename(command)) || isWindowsCommandInterpreter(command)) return 'disabled';
  return 'allowedWithPermission';
}

function isOperator(token) {
  return typeof token === 'object' && token?.op && token.op !== 'glob';
}

function pathBasename(command) {
  const parts = String(command).split(/[\\/]/);
  return parts[parts.length - 1]
    .toLowerCase()
    .replace(/\.(?:bat|cmd|com|exe)$/i, '');
}

function isWindowsCommandInterpreter(command) {
  if (!isWindows()) return false;
  const name = pathBasename(command);
  return name === 'cmd' || name === 'command' || /^%comspec(?::[^%]*)?%$/i.test(name);
}

function mostRestrictive(a, b) {
  if (a === 'disabled' || b === 'disabled') return 'disabled';
  if (a === 'allowedWithPermission' || b === 'allowedWithPermission') {
    return 'allowedWithPermission';
  }
  return 'allowedWithoutPermission';
}
