import fs from 'node:fs/promises';
import path from 'node:path';
import { detectAppLaunch } from './appLauncher.js';
import { detectContainerRuntime } from './containerRuntime.js';
import { inferWorkspaceHooks } from './harness.js';
import { inspectLauncher } from './launcher.js';
import { detectPackageManager, readPackageJson } from './project.js';
import { readWorkspaceProfile } from './workspaceProfile.js';

export async function createWorkspacePlan(cwd) {
  const [packageJson, hooks, profile, container, app, hooksFile, launcher] = await Promise.all([
    readPackageJson(cwd),
    inferWorkspaceHooks(cwd),
    readWorkspaceProfile(cwd),
    detectContainerRuntime(cwd),
    detectAppLaunch(cwd),
    fileExists(path.join(cwd, '.codepark', 'hooks.json')),
    inspectLauncher(cwd)
  ]);
  const packageManager = packageJson ? await detectPackageManager(cwd) : '';
  const appTypes = inferAppTypes({ packageJson, hooks, container, app });
  const missing = [];
  if (!profile) missing.push('profile-init');
  if (!hooksFile && Object.keys(hooks.hooks).length) missing.push('harness-init');
  if (!launcher.ready) missing.push('launcher-install');
  if (!app.command) missing.push('app-launch-command');

  return {
    version: 1,
    cwd,
    appTypes,
    package: packageJson ? {
      name: packageJson.name ?? '',
      version: packageJson.version ?? '',
      packageManager,
      scripts: Object.keys(packageJson.scripts ?? {}).sort()
    } : null,
    launch: app,
    hooks: {
      adapters: hooks.adapters,
      packageManager: hooks.packageManager,
      inferred: hooks.hooks,
      configured: hooksFile
    },
    profile: {
      configured: Boolean(profile),
      app: profile?.app ?? {},
      policy: profile?.policy ?? null
    },
    container: {
      runtime: container.runtime,
      composeCommand: container.composeCommand,
      files: container.files,
      risks: container.risks
    },
    launcher: {
      configured: launcher.configured,
      ready: launcher.ready,
      path: launcher.path,
      checks: launcher.checks,
      message: launcher.message
    },
    ready: missing.length === 0,
    missing,
    nextActions: nextActions(missing, app)
  };
}

export function formatWorkspacePlan(plan) {
  const hookNames = Object.keys(plan.hooks.inferred);
  const lines = [
    'Workspace plan',
    `- cwd: ${plan.cwd}`,
    `- app types: ${plan.appTypes.length ? plan.appTypes.join(', ') : 'unknown'}`,
    `- package: ${plan.package ? `${plan.package.name || 'unnamed'}${plan.package.version ? `@${plan.package.version}` : ''} (${plan.package.packageManager})` : 'none'}`,
    `- launch: ${plan.launch.command ? `${plan.launch.command} (${plan.launch.source})` : plan.launch.message}`,
    `- hooks: ${hookNames.length ? hookNames.join(', ') : 'none'}${plan.hooks.configured ? ' (configured)' : ''}`,
    `- profile: ${plan.profile.configured ? 'configured' : 'missing'}`,
    `- launcher: ${plan.launcher.ready ? 'ready' : (plan.launcher.configured ? `needs update (${plan.launcher.message})` : 'missing')}`,
    `- container: ${plan.container.runtime || 'none'}${plan.container.files.length ? ` (${plan.container.files.join(', ')})` : ''}`,
    `- ready: ${plan.ready ? 'yes' : 'no'}`
  ];
  if (plan.missing.length) lines.push(`- missing: ${plan.missing.join(', ')}`);
  lines.push('', 'Next actions:');
  for (const action of plan.nextActions) lines.push(`- ${action}`);
  return lines.join('\n');
}

export function formatWorkspacePlanJson(plan) {
  return JSON.stringify(plan, null, 2);
}

function inferAppTypes({ packageJson, hooks, container, app }) {
  const types = new Set(hooks.adapters);
  if (app?.source === 'java' || app?.source === 'php' || app?.source === 'ruby') types.add(app.source);
  const deps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  };
  if (deps.next) types.add('next');
  if (deps.vite || deps['@vitejs/plugin-react']) types.add('vite');
  if (deps.react) types.add('react');
  if (deps.vue) types.add('vue');
  if (deps.svelte) types.add('svelte');
  if (deps.express || deps.fastify || deps.koa) types.add('node-server');
  if (container.files.length) types.add('compose');
  return [...types].sort();
}

function nextActions(missing, app) {
  const actions = [];
  if (missing.includes('profile-init')) actions.push('codepark profile-init');
  if (missing.includes('harness-init')) actions.push('codepark harness-init');
  if (missing.includes('launcher-install')) actions.push('codepark launcher-install');
  if (app.command) actions.push('codepark app-start');
  else actions.push('add a dev/start/serve package script, Makefile target, Compose file, or .codepark/profile.json app.command');
  actions.push('codepark dashboard-open');
  return actions;
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
