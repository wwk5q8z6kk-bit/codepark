import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './atomicWrite.js';
import { detectContainerRuntime } from './containerRuntime.js';
import { inferWorkspaceHooks } from './harness.js';
import { defaultPolicy, getPolicyPreset } from './policyPresets.js';

const profilePath = path.join('.codepark', 'profile.json');

export async function readWorkspaceProfile(cwd) {
  const file = path.join(cwd, profilePath);
  const text = await fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  if (!text) return null;
  const parsed = JSON.parse(text);
  return normalizeProfile(parsed);
}

export async function initWorkspaceProfile(cwd, options = {}) {
  const inferredHooks = await inferWorkspaceHooks(cwd);
  const container = await detectContainerRuntime(cwd);
  const policy = await inferDefaultPolicy(cwd);
  const profile = normalizeProfile({
    version: 1,
    hooks: inferredHooks.hooks,
    app: {},
    policy,
    container: {
      runtime: 'auto',
      preferred: ['podman', 'docker'],
      detected: container.runtime || '',
      files: container.files
    }
  });

  const file = path.join(cwd, profilePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  let overwritten = false;
  if (options.force) {
    overwritten = await exists(file);
    await writeJsonAtomic(file, profile);
  } else {
    await fs.writeFile(file, `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx' }).catch(error => {
      if (error?.code === 'EEXIST') {
        throw new Error(`${profilePath} already exists. Re-run with --force to replace it.`);
      }
      throw error;
    });
  }

  return {
    path: profilePath,
    profile,
    overwritten
  };
}

export async function writeWorkspaceProfile(cwd, profile) {
  const normalized = normalizeProfile(profile);
  const file = path.join(cwd, profilePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, normalized);
  return {
    path: profilePath,
    profile: normalized
  };
}

export function formatWorkspaceProfile(profile) {
  if (!profile) return 'No workspace profile configured.';
  const hookNames = Object.keys(profile.hooks ?? {});
  return [
    'Workspace profile',
    `- version: ${profile.version}`,
    `- app command: ${profile.app?.command || 'auto'}`,
    `- app script: ${profile.app?.script || 'auto'}`,
    `- hooks: ${hookNames.length ? hookNames.join(', ') : 'none'}`,
    `- policy write: ${profile.policy?.write?.allow?.length ? `allow ${profile.policy.write.allow.join(', ')}` : 'allow workspace'}; deny ${profile.policy?.write?.deny?.length ? profile.policy.write.deny.join(', ') : 'none'}`,
    `- container runtime: ${profile.container?.runtime || 'auto'}`,
    `- container preferred: ${profile.container?.preferred?.length ? profile.container.preferred.join(', ') : 'podman, docker'}`
  ].join('\n');
}

export function formatWorkspaceProfileInit(result) {
  return [
    `${result.overwritten ? 'Rewrote' : 'Wrote'} ${result.path}`,
    formatWorkspaceProfile(result.profile),
    '',
    'Edit .codepark/profile.json to pin app.command, app.script, hooks, or container runtime preferences.'
  ].join('\n');
}

function normalizeProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${profilePath} must be a JSON object`);
  }
  return {
    version: Number.isInteger(value.version) ? value.version : 1,
    hooks: normalizeHooks(value.hooks),
    app: normalizeApp(value.app),
    policy: normalizePolicy(value.policy),
    container: normalizeContainer(value.container)
  };
}

function normalizeHooks(value) {
  if (!value) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${profilePath} hooks must be an object`);
  const hooks = {};
  for (const [name, rawCommands] of Object.entries(value)) {
    const hookName = String(name ?? '').trim();
    if (!/^[A-Za-z0-9_.:-]+$/.test(hookName)) throw new Error(`invalid profile hook name: ${name}`);
    const commands = Array.isArray(rawCommands) ? rawCommands : [rawCommands];
    hooks[hookName] = commands.map(command => String(command ?? '').trim()).filter(Boolean);
    if (!hooks[hookName].length) throw new Error(`profile hook has no commands: ${hookName}`);
  }
  return hooks;
}

function normalizeApp(value) {
  if (!value) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${profilePath} app must be an object`);
  const app = {};
  if (value.command) app.command = String(value.command).trim();
  if (value.script) app.script = String(value.script).trim();
  return app;
}

function normalizePolicy(value) {
  if (!value) return cloneDefaultPolicy();
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${profilePath} policy must be an object`);
  const policy = cloneDefaultPolicy();
  if (value.write && (typeof value.write !== 'object' || Array.isArray(value.write))) {
    throw new Error(`${profilePath} policy.write must be an object`);
  }
  if (value.commands && (typeof value.commands !== 'object' || Array.isArray(value.commands))) {
    throw new Error(`${profilePath} policy.commands must be an object`);
  }
  const write = value.write ?? {};
  const commands = value.commands ?? {};
  return {
    write: {
      allow: normalizeStringList(write.allow ?? policy.write.allow),
      deny: normalizeStringList(write.deny ?? policy.write.deny)
    },
    commands: {
      denyCommands: normalizeStringList(commands.denyCommands ?? commands.deny_commands ?? policy.commands.denyCommands),
      denyPatterns: normalizeStringList(commands.denyPatterns ?? commands.deny_patterns ?? policy.commands.denyPatterns)
    }
  };
}

function normalizeContainer(value) {
  if (!value) return { runtime: 'auto', preferred: ['podman', 'docker'] };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${profilePath} container must be an object`);
  return {
    runtime: String(value.runtime || 'auto').trim(),
    preferred: Array.isArray(value.preferred)
      ? value.preferred.map(item => String(item).trim()).filter(Boolean)
      : ['podman', 'docker'],
    detected: String(value.detected || '').trim(),
    files: Array.isArray(value.files) ? value.files.map(item => String(item).trim()).filter(Boolean) : []
  };
}

async function inferDefaultPolicy(cwd) {
  if (await exists(path.join(cwd, 'package.json'))) return getPolicyPreset('node-app');
  if (
    await exists(path.join(cwd, 'pyproject.toml')) ||
    await exists(path.join(cwd, 'setup.py')) ||
    await exists(path.join(cwd, 'setup.cfg')) ||
    await exists(path.join(cwd, 'requirements.txt'))
  ) {
    return getPolicyPreset('python-app');
  }
  if (
    await exists(path.join(cwd, 'build.gradle')) ||
    await exists(path.join(cwd, 'build.gradle.kts')) ||
    await exists(path.join(cwd, 'gradlew')) ||
    await exists(path.join(cwd, 'pom.xml'))
  ) {
    return getPolicyPreset('java-app');
  }
  if (
    await exists(path.join(cwd, 'composer.json')) ||
    await exists(path.join(cwd, 'phpunit.xml')) ||
    await exists(path.join(cwd, 'phpunit.xml.dist')) ||
    await exists(path.join(cwd, 'public', 'index.php')) ||
    await exists(path.join(cwd, 'index.php'))
  ) {
    return getPolicyPreset('php-app');
  }
  if (
    await exists(path.join(cwd, 'Gemfile')) ||
    await exists(path.join(cwd, 'Rakefile')) ||
    await exists(path.join(cwd, 'config.ru')) ||
    await exists(path.join(cwd, 'bin', 'rails')) ||
    await exists(path.join(cwd, 'config', 'application.rb'))
  ) {
    return getPolicyPreset('ruby-app');
  }
  return cloneDefaultPolicy();
}

function cloneDefaultPolicy() {
  return {
    write: {
      allow: [...defaultPolicy.write.allow],
      deny: [...defaultPolicy.write.deny]
    },
    commands: {
      denyCommands: [...defaultPolicy.commands.denyCommands],
      denyPatterns: [...defaultPolicy.commands.denyPatterns]
    }
  };
}

function normalizeStringList(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  return list.map(item => String(item ?? '').trim()).filter(Boolean);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
