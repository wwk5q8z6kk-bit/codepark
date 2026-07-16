import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createSubprocessEnv } from './env.js';
import { evaluateWorkspaceCommandPolicy } from './workspacePolicy.js';

const execAsync = promisify(exec);
const hooksFile = path.join('.codepark', 'hooks.json');

export async function listHooks(cwd) {
  const config = await readHooksConfig(cwd);
  return Object.entries(config.hooks)
    .map(([name, commands]) => ({ name, commands }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function runHook(cwd, name, options = {}) {
  const hooks = await listHooks(cwd);
  const hook = resolveHook(hooks, name);
  const steps = [];
  for (const command of hook.commands) {
    if (await evaluateWorkspaceCommandPolicy(cwd, command) === 'disabled') {
      throw new Error(`blocked by command safety policy: ${command}`);
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: options.timeoutMs ?? 120000,
        maxBuffer: 1024 * 1024,
        env: createSubprocessEnv(process.env),
        shell: process.env.SHELL || '/bin/sh'
      });
      steps.push({ command, stdout, stderr });
    } catch (error) {
      const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
      const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
      const fallback = error instanceof Error ? error.message : String(error);
      throw new Error([
        `Hook failed: ${hook.name}`,
        `$ ${command}`,
        trimOutput([stdout, stderr].filter(Boolean).join('\n') || fallback)
      ].join('\n'));
    }
  }
  return { name: hook.name, steps };
}

export function formatHookList(hooks) {
  if (!hooks.length) return 'No hooks configured.';
  return hooks.map(hook => `${hook.name} | ${hook.commands.join(' && ')}`).join('\n');
}

export function formatHookRun(result) {
  return [
    `Hook passed: ${result.name}`,
    ...result.steps.flatMap(step => [
      `$ ${step.command}`,
      trimOutput([step.stdout, step.stderr].filter(Boolean).join('\n'))
    ])
  ].join('\n');
}

async function readHooksConfig(cwd) {
  const file = path.join(cwd, hooksFile);
  const text = await fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  if (!text) return { hooks: {} };
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${hooksFile} must be a JSON object`);
  }
  const hooks = parsed.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error(`${hooksFile} requires a hooks object`);
  }
  return { hooks: normalizeHooks(hooks) };
}

function normalizeHooks(hooks) {
  const normalized = {};
  for (const [name, value] of Object.entries(hooks)) {
    const hookName = String(name).trim();
    if (!/^[A-Za-z0-9_.:-]+$/.test(hookName)) {
      throw new Error(`invalid hook name: ${name}`);
    }
    const commands = Array.isArray(value) ? value : [value];
    normalized[hookName] = commands.map(command => normalizeHookCommand(hookName, command)).filter(Boolean);
    if (!normalized[hookName].length) throw new Error(`hook has no commands: ${hookName}`);
  }
  return normalized;
}

function normalizeHookCommand(hookName, command) {
  if (typeof command !== 'string') {
    throw new Error(`hook command must be a string: ${hookName}`);
  }
  return command.trim();
}

function resolveHook(hooks, name) {
  const needle = String(name ?? '').trim();
  if (!needle) throw new Error('hook name is required');
  const exact = hooks.find(hook => hook.name === needle);
  if (exact) return exact;
  const matches = hooks.filter(hook => hook.name.startsWith(needle));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`hook name prefix is ambiguous: ${needle}`);
  throw new Error(`hook not found: ${needle}`);
}

function trimOutput(value) {
  const max = 60000;
  if (!value) return '[command completed with no output]';
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value.trim();
}
