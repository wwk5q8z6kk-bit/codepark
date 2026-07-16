import { createReadinessReport } from './readiness.js';
import { createWorkspacePlan } from './workspacePlan.js';
import { addTask, listTasks } from './tasks.js';

export async function createProjectAssessment(cwd, config) {
  const [readiness, workspace] = await Promise.all([
    createReadinessReport(cwd, config),
    createWorkspacePlan(cwd)
  ]);
  const gaps = collectGaps({ readiness, workspace });
  const nextActions = collectNextActions({ readiness, workspace });

  return {
    version: 1,
    cwd,
    summary: {
      localTestingReady: readiness.localUse.ready && workspace.ready,
      secureHarnessReady: readiness.secureHarness.ready,
      workspaceReady: workspace.ready
    },
    package: readiness.package,
    endpoint: readiness.endpoint,
    workspace: {
      appTypes: workspace.appTypes,
      launch: workspace.launch,
      hooks: workspace.hooks,
      profile: workspace.profile,
      launcher: workspace.launcher,
      container: workspace.container,
      missing: workspace.missing
    },
    readiness,
    gaps,
    nextActions
  };
}

export function formatProjectAssessment(report) {
  return [
    'CodePark assessment',
    `- cwd: ${report.cwd}`,
    `- package: ${report.package.name || 'unknown'}@${report.package.version || 'unknown'}`,
    `- local testing: ${report.summary.localTestingReady ? 'ready' : 'not ready'}`,
    `- secure harness: ${report.summary.secureHarnessReady ? 'ready' : 'not ready'}`,
    `- endpoint: ${report.endpoint.provider} (${report.endpoint.baseUrl})`,
    `- launch: ${report.workspace.launch.command || report.workspace.launch.message}`,
    `- hooks: ${Object.keys(report.workspace.hooks.inferred ?? {}).join(', ') || 'none'}${report.workspace.hooks.configured ? ' (configured)' : ''}`,
    `- container: ${report.workspace.container.runtime || 'none'}`,
    '',
    'Gaps:',
    ...formatList(report.gaps, '- none'),
    '',
    'Next actions:',
    ...formatList(report.nextActions, '- none')
  ].join('\n');
}

export function formatProjectAssessmentJson(report) {
  return JSON.stringify(report, null, 2);
}

export async function createAssessmentTasks(cwd, config, options = {}) {
  const assessment = await createProjectAssessment(cwd, config);
  const existing = await listTasks(cwd);
  const tasks = assessment.gaps.map(gapToTask);
  const added = [];
  const skipped = [];

  for (const task of tasks) {
    const match = existing.find(item => item.title === task.title);
    if (match && !options.force) {
      skipped.push({ ...match, reason: 'already exists' });
      continue;
    }
    const created = await addTask(cwd, task);
    existing.push(created);
    added.push(created);
  }

  return {
    version: 1,
    cwd,
    added,
    skipped,
    assessment
  };
}

export function formatAssessmentTasks(result) {
  return [
    'Assessment tasks',
    `- added: ${result.added.length}`,
    `- skipped: ${result.skipped.length}`,
    '',
    'Added:',
    ...formatTaskList(result.added),
    '',
    'Skipped:',
    ...formatSkippedTaskList(result.skipped)
  ].join('\n');
}

export function formatAssessmentTasksJson(result) {
  return JSON.stringify(result, null, 2);
}

function collectGaps({ readiness, workspace }) {
  const gaps = [];
  if (!workspace.ready) {
    for (const missing of workspace.missing) {
      gaps.push(`workspace: missing ${missing}`);
    }
  }
  for (const check of readiness.checks.localUse.filter(item => !item.ok)) {
    gaps.push(`local-use: ${check.name} - ${check.message}`);
  }
  for (const check of readiness.checks.secureHarness.filter(item => !item.ok)) {
    gaps.push(`secure-harness: ${check.name} - ${check.message}`);
  }
  return gaps;
}

function collectNextActions({ readiness, workspace }) {
  const actions = [];
  for (const action of workspace.nextActions ?? []) actions.push(action);
  if (!readiness.secureHarness.ready) actions.push('codepark --secure readiness');
  return [...new Set(actions)];
}

function formatList(items, empty) {
  if (!items.length) return [empty];
  return items.map(item => `- ${item}`);
}

function gapToTask(gap) {
  const text = String(gap);
  const separator = text.indexOf(': ');
  const scope = separator === -1 ? 'assessment' : text.slice(0, separator);
  const detail = separator === -1 ? text : text.slice(separator + 2);
  return {
    title: `Resolve ${scope} gap: ${detail}`,
    priority: 'high',
    labels: ['assessment', scope],
    notes: `Generated from codepark assess.\nGap: ${gap}`
  };
}

function formatTaskList(tasks) {
  if (!tasks.length) return ['- none'];
  return tasks.map(task => `- ${task.id}: ${task.title}`);
}

function formatSkippedTaskList(tasks) {
  if (!tasks.length) return ['- none'];
  return tasks.map(task => `- ${task.id}: ${task.title} (${task.reason})`);
}
