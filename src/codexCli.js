import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createSubprocessEnv } from './env.js';
import { formatCodexProgressMessage, readCodexProgressIntervalMs } from './codexProgress.js';
import { isCodexBaseUrl } from './config.js';
import { parseShellWords } from './shellSyntax.js';

const codexDefaultModel = 'codex-cli-default';

export function isCodexCliConfig(config) {
  return config.provider === 'codex' || isCodexBaseUrl(config.baseUrl);
}

export async function askCodexCli({
  messages,
  config,
  cwd,
  onToken,
  onStatus,
  codexCommand = process.env.CODEPARK_CODEX_COMMAND || 'codex',
  progressIntervalMs = readCodexProgressIntervalMs()
}) {
  const outputFile = path.join(os.tmpdir(), `codepark-codex-${process.pid}-${Date.now()}.txt`);
  const sandbox = config.secureMode ? 'read-only' : 'workspace-write';
  const args = [
    'exec',
    '--cd',
    cwd,
    '--sandbox',
    sandbox,
    '--skip-git-repo-check',
    '--output-last-message',
    outputFile,
    '--color',
    'never'
  ];

  if (config.model && config.model !== codexDefaultModel) {
    args.push('--model', config.model);
  }

  args.push(formatMessagesForCodex(messages));

  const result = await runCodex(args, cwd, {
    onStatus,
    progressIntervalMs,
    secureMode: config.secureMode,
    codexCommand
  });
  const finalMessage = await fs.readFile(outputFile, 'utf8').catch(() => '');
  await fs.rm(outputFile, { force: true }).catch(() => {});

  if (result.code !== 0) {
    throw new Error(`codex cli failed (${result.code}): ${trimOutput(result.stderr || result.stdout)}`);
  }

  const content = finalMessage.trim() || result.stdout.trim();
  if (!content) throw new Error('codex cli completed without a final message');
  onToken?.(content);
  return content;
}

export function formatMessagesForCodex(messages) {
  const transcript = messages
    .filter(message => typeof message.content === 'string' && message.content.trim())
    .map(message => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join('\n\n');

  return [
    'You are running as the model backend for CodePark.',
    'Stay focused on the current workspace. If the user refers to you, yourself, this app, or the tool, treat that as CodePark.',
    'Use the local repository context directly. For code changes, keep edits small and verify them.',
    '',
    transcript
  ].join('\n');
}

function runCodex(args, cwd, { onStatus, progressIntervalMs, codexCommand = 'codex' } = {}) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const command = Array.isArray(codexCommand) ? codexCommand : parseShellWords(codexCommand);
    if (command.some(part => typeof part !== 'string')) {
      resolve({ code: 127, stdout: '', stderr: 'codex command may not contain shell operators' });
      return;
    }
    const [executable, ...commandArgs] = command.map(value => String(value ?? '').trim()).filter(Boolean);
    if (!executable) {
      resolve({ code: 127, stdout: '', stderr: 'codex command is required' });
      return;
    }
    const child = spawn(executable, [...commandArgs, ...args], {
      cwd,
      env: createSubprocessEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let progressTimer;
    let settled = false;

    if (typeof onStatus === 'function' && Number.isFinite(progressIntervalMs) && progressIntervalMs > 0) {
      progressTimer = setInterval(() => {
        emitStatus(onStatus, formatCodexProgressMessage(Date.now() - startedAt));
      }, progressIntervalMs);
      progressTimer.unref?.();
    }

    const finish = result => {
      if (settled) return;
      settled = true;
      if (progressTimer) clearInterval(progressTimer);
      resolve(result);
    };

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', error => {
      finish({ code: 127, stdout, stderr: error.message });
    });
    child.on('close', code => {
      finish({ code: code ?? 1, stdout, stderr });
    });
  });
}

function emitStatus(onStatus, message) {
  try {
    onStatus(message);
  } catch {
    // Status updates should not change model execution semantics.
  }
}

function trimOutput(value) {
  const max = 1600;
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
