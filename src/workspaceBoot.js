import { startApp } from './appLauncher.js';
import { createBrowserDashboard, formatBrowserDashboard } from './dashboard.js';
import { formatHarnessInit, initHarness } from './harness.js';
import { formatLauncherInstall, installLauncher } from './launcher.js';
import { createWorkspacePlan, formatWorkspacePlan } from './workspacePlan.js';
import { formatWorkspaceProfileInit, initWorkspaceProfile } from './workspaceProfile.js';

export async function bootWorkspace(cwd, config, options = {}) {
  const before = await createWorkspacePlan(cwd);
  const steps = [];

  if (before.missing.includes('profile-init')) {
    steps.push(await runStep('profile', () => initWorkspaceProfile(cwd), formatWorkspaceProfileInit));
  } else {
    steps.push(skipStep('profile', 'profile already configured'));
  }

  if (before.missing.includes('harness-init')) {
    steps.push(await runStep('harness', () => initHarness(cwd), formatHarnessInit));
  } else {
    steps.push(skipStep('harness', before.hooks.configured ? 'hooks already configured' : 'no hookable commands found'));
  }

  if (before.missing.includes('launcher-install')) {
    steps.push(await runStep('launcher', () => installLauncher(cwd, { force: before.launcher.configured }), formatLauncherInstall));
  } else {
    steps.push(skipStep('launcher', 'launcher ready'));
  }

  let app = null;
  if (options.start === false) {
    steps.push(skipStep('app', 'app start disabled'));
  } else if (before.launch.command) {
    app = await startApp(cwd, { id: options.id });
    steps.push({
      name: 'app',
      ok: true,
      action: 'started',
      message: `App started: ${app.worker.id}`,
      result: app
    });
  } else {
    steps.push(skipStep('app', before.launch.message));
  }

  const dashboard = await createBrowserDashboard(cwd, config);
  steps.push({
    name: 'dashboard',
    ok: true,
    action: 'wrote',
    message: formatBrowserDashboard(dashboard),
    result: dashboard
  });

  const after = await createWorkspacePlan(cwd);
  return {
    version: 1,
    cwd,
    ready: after.ready,
    before,
    after,
    steps,
    app,
    dashboard
  };
}

export function formatWorkspaceBoot(result) {
  const lines = [
    'Workspace boot',
    `- cwd: ${result.cwd}`,
    `- ready: ${result.ready ? 'yes' : 'no'}`,
    '',
    'Steps:'
  ];
  for (const step of result.steps) {
    const status = step.ok ? 'ok' : 'fail';
    const firstLine = String(step.message ?? step.action).split(/\r?\n/)[0];
    lines.push(`- ${status} ${step.name}: ${step.action}${firstLine ? ` - ${firstLine}` : ''}`);
  }
  lines.push('', 'Current plan:');
  lines.push(formatWorkspacePlan(result.after));
  return lines.join('\n');
}

export function formatWorkspaceBootJson(result) {
  return JSON.stringify({
    ...result,
    steps: result.steps.map(summarizeStep),
    dashboard: summarizeDashboard(result.dashboard)
  }, null, 2);
}

async function runStep(name, run, format) {
  try {
    const result = await run();
    return {
      name,
      ok: true,
      action: result.overwritten ? 'rewrote' : 'wrote',
      message: format(result),
      result
    };
  } catch (error) {
    return {
      name,
      ok: false,
      action: 'failed',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function skipStep(name, message) {
  return {
    name,
    ok: true,
    action: 'skipped',
    message
  };
}

function summarizeStep(step) {
  if (step.name === 'dashboard') {
    return {
      ...step,
      result: summarizeDashboard(step.result)
    };
  }
  return step;
}

function summarizeDashboard(dashboard) {
  if (!dashboard) return null;
  return {
    path: dashboard.path,
    absolutePath: dashboard.absolutePath,
    generatedAt: dashboard.payload?.generatedAt ?? ''
  };
}
