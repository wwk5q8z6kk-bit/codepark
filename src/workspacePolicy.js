import path from 'node:path';
import { parseShellWords } from './shellSyntax.js';
import { evaluateCommandPolicy } from './security/commandPolicy.js';
import { isWindows } from './platform.js';
import {
  initWorkspaceProfile,
  readWorkspaceProfile,
  writeWorkspaceProfile
} from './workspaceProfile.js';
import {
  defaultPolicy,
  getPolicyPreset,
  listPolicyPresetNames,
  policyPresetExists
} from './policyPresets.js';

export async function readWorkspacePolicy(cwd) {
  const profile = await readWorkspaceProfile(cwd);
  return normalizePolicy(profile?.policy);
}

export async function createWorkspacePolicyReport(cwd) {
  return {
    version: 1,
    cwd,
    policy: await readWorkspacePolicy(cwd)
  };
}

export function listWorkspacePolicyPresets() {
  return listPolicyPresetNames();
}

export async function applyWorkspacePolicyPreset(cwd, name, options = {}) {
  const presetName = normalizePresetName(name);
  const policy = normalizePolicy(getPolicyPreset(presetName));
  let profile = await readWorkspaceProfile(cwd);
  let created = false;

  if (!profile) {
    profile = (await initWorkspaceProfile(cwd, { force: Boolean(options.force) })).profile;
    created = true;
  } else if (!options.force) {
    throw new Error('.codepark/profile.json already exists. Re-run with --force to update policy.');
  }

  const written = await writeWorkspaceProfile(cwd, {
    ...profile,
    policy
  });

  return {
    path: written.path,
    preset: presetName,
    policy,
    created,
    profile: written.profile
  };
}

export function formatWorkspacePolicyPreset(result) {
  return [
    `${result.created ? 'Created' : 'Updated'} ${result.path}`,
    `preset: ${result.preset}`,
    formatWorkspacePolicy({ policy: result.policy })
  ].join('\n');
}

export function formatWorkspacePolicy(report) {
  const policy = report.policy;
  return [
    'Workspace policy',
    `- write allow: ${policy.write.allow.length ? policy.write.allow.join(', ') : 'workspace'}`,
    `- write deny: ${policy.write.deny.length ? policy.write.deny.join(', ') : 'none'}`,
    `- command deny: ${policy.commands.denyCommands.length ? policy.commands.denyCommands.join(', ') : 'none'}`,
    `- command fragments: ${policy.commands.denyPatterns.length ? policy.commands.denyPatterns.join(', ') : 'none'}`
  ].join('\n');
}

export function formatWorkspacePolicyJson(report) {
  return JSON.stringify(report, null, 2);
}

export function normalizePolicy(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    write: normalizeWritePolicy(input.write),
    commands: normalizeCommandPolicy(input.commands)
  };
}

function normalizePresetName(name) {
  const presetName = String(name ?? '').trim();
  if (!presetName) throw new Error(`policy preset is required; available: ${listWorkspacePolicyPresets().join(', ')}`);
  if (!policyPresetExists(presetName)) {
    throw new Error(`unknown policy preset: ${presetName}; available: ${listWorkspacePolicyPresets().join(', ')}`);
  }
  return presetName;
}

export async function checkWorkspacePolicy(cwd, type, value) {
  const normalizedType = String(type ?? '').trim();
  if (normalizedType === 'write') return checkWorkspaceWritePolicy(cwd, value);
  if (normalizedType === 'command') return checkWorkspaceCommandPolicy(cwd, value);
  throw new Error('policy check type must be write or command');
}

export function formatWorkspacePolicyCheck(result) {
  return [
    `${result.allowed ? 'allowed' : 'blocked'} ${result.type}: ${result.value}`,
    `reason: ${result.reason}`
  ].join('\n');
}

export function formatWorkspacePolicyCheckJson(result) {
  return JSON.stringify({ version: 1, ...result }, null, 2);
}

export async function assertWorkspaceWriteAllowed(cwd, target) {
  const result = await checkWorkspaceWritePolicy(cwd, target);
  if (!result.allowed) throw new Error(result.reason);
}

export async function assertWorkspacePatchAllowed(cwd, patch) {
  const policy = await readWorkspacePolicy(cwd);
  const paths = extractPatchPaths(patch);
  for (const filePath of paths) {
    assertWriteAllowed(cwd, path.join(cwd, filePath), policy);
  }
}

export async function evaluateWorkspaceCommandPolicy(cwd, command) {
  const result = await checkWorkspaceCommandPolicy(cwd, command);
  return result.allowed ? result.policy : 'disabled';
}

export function extractPatchPaths(patch) {
  const paths = new Set();
  for (const line of String(patch ?? '').split(/\r?\n/)) {
    if (!line.startsWith('+++ ') && !line.startsWith('--- ')) continue;
    const rawPath = line.slice(4).trim();
    if (!rawPath || rawPath === '/dev/null') continue;
    const filePath = normalizePatchPath(rawPath);
    if (filePath) paths.add(filePath);
  }
  return [...paths].sort();
}

function normalizeWritePolicy(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    allow: normalizePatternList(input.allow ?? defaultPolicy.write.allow),
    deny: normalizePatternList(input.deny ?? defaultPolicy.write.deny)
  };
}

function normalizeCommandPolicy(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    denyCommands: normalizePatternList(input.denyCommands ?? input.deny_commands ?? defaultPolicy.commands.denyCommands)
      .map(normalizeCommandName),
    denyPatterns: normalizePatternList(input.denyPatterns ?? input.deny_patterns ?? defaultPolicy.commands.denyPatterns)
  };
}

function assertWriteAllowed(cwd, target, policy) {
  const result = evaluateWriteAllowed(cwd, target, policy);
  if (!result.allowed) throw new Error(result.reason);
}

async function checkWorkspaceWritePolicy(cwd, target) {
  const policy = await readWorkspacePolicy(cwd);
  const resolved = path.isAbsolute(String(target ?? ''))
    ? path.resolve(String(target ?? ''))
    : path.resolve(cwd, String(target ?? ''));
  return evaluateWriteAllowed(cwd, resolved, policy);
}

function evaluateWriteAllowed(cwd, target, policy) {
  const relativePath = toPosix(path.relative(cwd, target));
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return {
      type: 'write',
      value: relativePath || String(target),
      allowed: false,
      reason: `path escapes workspace policy: ${relativePath || target}`
    };
  }
  if (matchesAny(relativePath, policy.write.deny)) {
    return {
      type: 'write',
      value: relativePath,
      allowed: false,
      reason: `blocked by workspace write policy: ${relativePath}`
    };
  }
  if (policy.write.allow.length && !matchesAny(relativePath, policy.write.allow)) {
    return {
      type: 'write',
      value: relativePath,
      allowed: false,
      reason: `blocked by workspace write policy: ${relativePath}`
    };
  }
  return {
    type: 'write',
    value: relativePath,
    allowed: true,
    reason: 'allowed by workspace write policy'
  };
}

async function checkWorkspaceCommandPolicy(cwd, command) {
  const value = String(command ?? '').trim();
  const base = evaluateCommandPolicy(value);
  if (base === 'disabled') {
    return {
      type: 'command',
      value,
      allowed: false,
      policy: base,
      reason: 'blocked by built-in command safety policy'
    };
  }
  const policy = await readWorkspacePolicy(cwd);
  if (commandBlockedByWorkspacePolicy(value, policy)) {
    return {
      type: 'command',
      value,
      allowed: false,
      policy: 'disabled',
      reason: 'blocked by workspace command policy'
    };
  }
  return {
    type: 'command',
    value,
    allowed: true,
    policy: base,
    reason: 'allowed by command policies'
  };
}

function commandBlockedByWorkspacePolicy(command, policy) {
  const text = String(command ?? '');
  for (const pattern of policy.commands.denyPatterns) {
    if (text.includes(pattern)) return true;
  }
  if (!policy.commands.denyCommands.length) return false;

  let current = [];
  for (const token of parseShellWords(text)) {
    if (isOperator(token)) {
      if (tokensBlocked(current, policy.commands.denyCommands)) return true;
      current = [];
      continue;
    }
    if (typeof token === 'string') current.push(token);
  }
  return tokensBlocked(current, policy.commands.denyCommands);
}

function tokensBlocked(tokens, denyCommands) {
  const command = tokens[0];
  return Boolean(command && denyCommands.includes(normalizeCommandName(command)));
}

function normalizeCommandName(command) {
  const parts = String(command ?? '').split(/[\\/]/);
  const basename = parts[parts.length - 1];
  if (!isWindows()) return path.basename(basename);
  return basename
    .toLowerCase()
    .replace(/\.(?:bat|cmd|com|exe)$/i, '');
}

function normalizePatchPath(rawPath) {
  const first = rawPath.split(/\t/)[0].trim();
  const withoutPrefix = first.startsWith('a/') || first.startsWith('b/') ? first.slice(2) : first;
  const normalized = path.posix.normalize(withoutPrefix);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return '';
  return normalized;
}

function matchesAny(relativePath, patterns) {
  return patterns.some(pattern => matchesPattern(relativePath, pattern));
}

function matchesPattern(relativePath, pattern) {
  const normalizedPattern = toPosix(pattern);
  if (normalizedPattern === relativePath) return true;
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.includes('*')) return globToRegExp(normalizedPattern).test(relativePath);
  return false;
}

function globToRegExp(pattern) {
  const escaped = pattern
    .split('*')
    .map(part => part.replace(/[\\^$+?.()|[\]{}]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`);
}

function normalizePatternList(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  return list.map(item => toPosix(String(item ?? '').trim())).filter(Boolean);
}

function toPosix(value) {
  return String(value ?? '').replaceAll(path.sep, '/');
}

function isOperator(token) {
  return typeof token === 'object' && token?.op && token.op !== 'glob';
}
