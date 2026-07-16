import fs from 'node:fs/promises';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createSubprocessEnv } from './env.js';
import {
  createAssessmentTasks,
  createProjectAssessment,
  formatAssessmentTasks,
  formatAssessmentTasksJson,
  formatProjectAssessment,
  formatProjectAssessmentJson
} from './assessment.js';
import { formatAppStart, startApp } from './appLauncher.js';
import {
  createCheckpoint,
  formatCheckpointCreated,
  formatCheckpointList,
  formatCheckpointRestored,
  listCheckpoints,
  restoreCheckpoint
} from './checkpoint.js';
import {
  createCodeIndex,
  findCodeSymbols,
  formatCodeIndex,
  formatCodeSymbolResults
} from './codeIntelligence.js';
import {
  createAgentDashboard,
  createBrowserDashboard,
  formatAgentDashboard,
  formatAgentDashboardJson,
  formatBrowserDashboard
} from './dashboard.js';
import { createUnifiedDiff } from './diff.js';
import { formatDoctorReport, formatDoctorReportJson, runDoctor } from './doctor.js';
import {
  detectContainerRuntime,
  formatComposeStart,
  formatComposeStop,
  formatContainerRuntime,
  startCompose,
  stopCompose
} from './containerRuntime.js';
import { formatGitSummary, gitDiff, gitStatus, gitSummary } from './git.js';
import { formatHarnessInit, initHarness } from './harness.js';
import { formatHookList, formatHookRun, listHooks, runHook } from './hooks.js';
import { formatLauncherInstall, installLauncher } from './launcher.js';
import { callWorkspaceMcpTool, formatMcpToolCallResult, formatWorkspaceMcpTools, listWorkspaceMcpTools } from './mcp/runtime.js';
import { readImageInfo } from './imageInfo.js';
import { createReadinessReport, formatReadinessReport, formatReadinessReportJson } from './readiness.js';
import { detectPackageManager, projectOverview, readPackageJson } from './project.js';
import { runQualityGate } from './qualityGate.js';
import {
  formatWorkspaceProfile,
  formatWorkspaceProfileInit,
  initWorkspaceProfile,
  readWorkspaceProfile
} from './workspaceProfile.js';
import { createWorkspacePlan, formatWorkspacePlan, formatWorkspacePlanJson } from './workspacePlan.js';
import { defaultIgnoredDirs, findFiles, searchText } from './search.js';
import {
  formatInstalledSkillPackage,
  formatLocalSkill,
  formatLocalSkillList,
  formatPackedSkill,
  installSkillPackage,
  listLocalSkills,
  packLocalSkill,
  readLocalSkill
} from './skills.js';
import {
  formatShellSessionCommand,
  formatShellSessionList,
  formatShellSessionRead,
  formatShellSessionStarted,
  formatShellSessionStopped,
  listShellSessions,
  readShellSession,
  sendShellSessionCommand,
  startShellSession,
  stopShellSession
} from './shellSession.js';
import {
  addTask,
  completeTask,
  formatTaskDetails,
  formatTaskAdded,
  formatTaskCompleted,
  formatTaskList,
  formatTaskDetailsJson,
  formatTaskListJson,
  formatTaskReopened,
  formatTaskUpdated,
  getTask,
  listTasks,
  reopenTask,
  updateTask
} from './tasks.js';
import { resolveWorkspacePath, summarizeDirectory } from './workspace.js';
import {
  formatWorkerList,
  formatWorkerListJson,
  formatWorkerPruned,
  formatWorkerPrunedJson,
  formatWorkerRead,
  formatWorkerReadClean,
  formatWorkerReadJson,
  formatWorkerStarted,
  formatWorkerStopped,
  listWorkers,
  pruneWorkers,
  readWorker,
  sendAgentMessage,
  formatAgentMessageSent,
  startAgentWorker,
  startWorker,
  stopWorker
} from './workers.js';
import { webFetch } from './webFetch.js';
import { bootWorkspace, formatWorkspaceBoot, formatWorkspaceBootJson } from './workspaceBoot.js';
import {
  applyWorkspacePolicyPreset,
  assertWorkspacePatchAllowed,
  assertWorkspaceWriteAllowed,
  checkWorkspacePolicy,
  createWorkspacePolicyReport,
  evaluateWorkspaceCommandPolicy,
  formatWorkspacePolicy,
  formatWorkspacePolicyCheck,
  formatWorkspacePolicyCheckJson,
  formatWorkspacePolicyJson,
  formatWorkspacePolicyPreset,
  listWorkspacePolicyPresets
} from './workspacePolicy.js';

const execAsync = promisify(exec);

const ignoredDirs = defaultIgnoredDirs;

export function createTools({ cwd, assumeYes, rl, config = {} }) {
  return {
    schemas: toolSchemas({ localOnly: Boolean(config.localOnly) }),
    execute: (name, args) => executeTool({ name, args, cwd, assumeYes, rl, config })
  };
}

async function executeTool({ name, args, cwd, assumeYes, rl, config }) {
  if (name === 'list_files') {
    const target = await resolveWorkspacePath(cwd, args.path ?? '.', { mustExist: true, directory: true });
    return summarizeDirectory(target, {
      root: cwd,
      maxDepth: clampNumber(args.max_depth, 1, 5, 2),
      ignore: ignoredDirs
    });
  }

  if (name === 'read_file') {
    const target = await resolveWorkspacePath(cwd, args.path, { mustExist: true, file: true });
    const maxBytes = clampNumber(args.max_bytes, 1000, 200000, 30000);
    const buffer = await fs.readFile(target);
    const content = buffer.subarray(0, maxBytes).toString('utf8');
    const suffix = buffer.length > maxBytes ? `\n\n[truncated after ${maxBytes} bytes]` : '';
    return `${path.relative(cwd, target)}\n\n${content}${suffix}`;
  }

  if (name === 'read_notebook') {
    const target = await resolveWorkspacePath(cwd, args.path, { mustExist: true, file: true });
    const maxBytes = clampNumber(args.max_bytes, 10000, 2_000_000, 250_000);
    const maxCells = clampNumber(args.max_cells, 1, 200, 40);
    const includeOutputs = Boolean(args.include_outputs);
    const buffer = await fs.readFile(target);
    if (buffer.length > maxBytes) {
      throw new Error(`notebook exceeds max_bytes (${buffer.length} > ${maxBytes})`);
    }
    const notebook = JSON.parse(buffer.toString('utf8'));
    return formatNotebookSummary(notebook, {
      path: path.relative(cwd, target),
      maxCells,
      includeOutputs
    });
  }

  if (name === 'image_info') {
    const target = await resolveWorkspacePath(cwd, args.path, { mustExist: true, file: true });
    const info = await readImageInfo(target);
    const relativePath = path.relative(cwd, target);
    return [
      relativePath,
      '',
      'Image info:',
      `- mime: ${info.mime || 'unknown'}`,
      `- bytes: ${info.bytes}`,
      `- width: ${info.width ?? 'unknown'}`,
      `- height: ${info.height ?? 'unknown'}`
    ].join('\n');
  }

  if (name === 'web_fetch') {
    if (config.localOnly) throw new Error('web_fetch is disabled in local-only mode');
    const url = String(args.url ?? '').trim();
    if (!url) throw new Error('web_fetch requires a url');
    await confirm(rl, assumeYes, `Fetch URL: ${url}`);
    const result = await webFetch(url, {
      method: args.method,
      headers: args.headers && typeof args.headers === 'object' ? args.headers : undefined,
      timeoutMs: clampNumber(args.timeout_ms, 1000, 120000, 20000),
      maxBytes: clampNumber(args.max_bytes, 1000, 2_000_000, 200000),
      followRedirects: Boolean(args.follow_redirects)
    });
    const payload = {
      url,
      status: result.status,
      headers: sortObjectKeys(result.headers || {}),
      bodyText: result.bodyText || '',
      truncated: Boolean(result.truncated)
    };
    if (args.json) return `${JSON.stringify(payload, null, 2)}\n`;
    const headerLines = Object.entries(payload.headers || {})
      .slice(0, 30)
      .map(([key, value]) => `- ${key}: ${value}`);
    return [
      `Fetched ${url}`,
      '',
      `Status: ${payload.status}`,
      '',
      'Headers:',
      ...(headerLines.length ? headerLines : ['- (none)']),
      '',
      'Body:',
      payload.bodyText,
      ...(payload.truncated ? ['', '[truncated]'] : [])
    ].join('\n');
  }

  if (name === 'project_overview') {
    return projectOverview(cwd, { scriptsOnly: Boolean(args.scripts_only) });
  }

  if (name === 'workspace_plan') {
    const plan = await createWorkspacePlan(cwd);
    return args.json ? formatWorkspacePlanJson(plan) : formatWorkspacePlan(plan);
  }

  if (name === 'workspace_boot') {
    await confirm(rl, assumeYes, `Boot workspace harness in ${cwd}?`);
    const result = await bootWorkspace(cwd, config, {
      start: args.start !== false,
      id: args.id
    });
    return args.json ? formatWorkspaceBootJson(result) : formatWorkspaceBoot(result);
  }

  if (name === 'read_profile') {
    return formatWorkspaceProfile(await readWorkspaceProfile(cwd));
  }

  if (name === 'read_policy') {
    const report = await createWorkspacePolicyReport(cwd);
    return args.json ? formatWorkspacePolicyJson(report) : formatWorkspacePolicy(report);
  }

  if (name === 'check_policy') {
    const type = String(args.type ?? '').trim();
    const value = String(args.value ?? '').trim();
    if (!type || !value) throw new Error('check_policy requires type and value');
    const result = await checkWorkspacePolicy(cwd, type, value);
    return args.json ? formatWorkspacePolicyCheckJson(result) : formatWorkspacePolicyCheck(result);
  }

  if (name === 'list_policy_presets') {
    return `Workspace policy presets\n${listWorkspacePolicyPresets().map(preset => `- ${preset}`).join('\n')}`;
  }

  if (name === 'apply_policy_preset') {
    const preset = String(args.preset ?? '').trim();
    if (!preset) throw new Error('apply_policy_preset requires a preset name');
    await confirm(rl, assumeYes, `Apply workspace policy preset "${preset}" in ${cwd}?`);
    return formatWorkspacePolicyPreset(await applyWorkspacePolicyPreset(cwd, preset, {
      force: Boolean(args.force)
    }));
  }

  if (name === 'init_profile') {
    const force = Boolean(args.force);
    await confirm(rl, assumeYes, `${force ? 'Replace' : 'Create'} .codepark/profile.json in ${cwd}?`);
    return formatWorkspaceProfileInit(await initWorkspaceProfile(cwd, { force }));
  }

  if (name === 'container_runtime') {
    return formatContainerRuntime(await detectContainerRuntime(cwd));
  }

  if (name === 'compose_start') {
    const id = String(args.id ?? '').trim();
    await confirm(rl, assumeYes, `Start container compose${id ? ` worker "${id}"` : ''} in ${cwd}?`);
    return formatComposeStart(await startCompose(cwd, {
      detached: Boolean(args.detached),
      id
    }));
  }

  if (name === 'compose_stop') {
    await confirm(rl, assumeYes, `Run container compose down in ${cwd}?`);
    return formatComposeStop(await stopCompose(cwd));
  }

  if (name === 'doctor') {
    if (config.localOnly && args.mcp_health) throw new Error('doctor mcp_health is disabled in local-only mode');
    const report = await runDoctor(config, { cwd, mcpHealth: Boolean(args.mcp_health) });
    return args.json ? formatDoctorReportJson(report) : formatDoctorReport(report);
  }

  if (name === 'readiness') {
    const report = await createReadinessReport(cwd, config);
    return args.json ? formatReadinessReportJson(report) : formatReadinessReport(report);
  }

  if (name === 'project_assessment') {
    const report = await createProjectAssessment(cwd, config);
    return args.json ? formatProjectAssessmentJson(report) : formatProjectAssessment(report);
  }

  if (name === 'create_assessment_tasks') {
    await confirm(rl, assumeYes, `Write assessment gap tasks in ${cwd}?`);
    const result = await createAssessmentTasks(cwd, config, { force: Boolean(args.force) });
    return args.json ? formatAssessmentTasksJson(result) : formatAssessmentTasks(result);
  }

  if (name === 'find_files') {
    const target = await resolveWorkspacePath(cwd, args.path ?? '.', { mustExist: true, directory: true });
    return findFiles({
      root: cwd,
      directory: target,
      pattern: String(args.pattern ?? ''),
      maxResults: clampNumber(args.max_results, 1, 500, 100),
      ignore: ignoredDirs
    });
  }

  if (name === 'search_text') {
    const target = await resolveWorkspacePath(cwd, args.path ?? '.', { mustExist: true, directory: true });
    return searchText({
      root: cwd,
      directory: target,
      pattern: String(args.pattern ?? ''),
      regex: Boolean(args.regex),
      caseSensitive: args.case_sensitive !== false,
      maxMatches: clampNumber(args.max_matches, 1, 500, 100),
      ignore: ignoredDirs
    });
  }

  if (name === 'code_index') {
    const target = await resolveWorkspacePath(cwd, args.path ?? '.', { mustExist: true, directory: true });
    const index = await createCodeIndex(target, {
      maxFiles: clampNumber(args.max_files, 1, 1000, 250),
      maxBytes: clampNumber(args.max_bytes, 1000, 500000, 200000),
      includeImports: args.include_imports !== false
    });
    return formatCodeIndex(index, {
      title: 'Code Index',
      maxSymbols: clampNumber(args.max_symbols, 1, 200, 80),
      includeImports: args.include_imports !== false
    });
  }

  if (name === 'find_code_symbols') {
    const target = await resolveWorkspacePath(cwd, args.path ?? '.', { mustExist: true, directory: true });
    const results = await findCodeSymbols(target, String(args.query ?? ''), {
      kind: args.kind,
      maxFiles: clampNumber(args.max_files, 1, 1000, 250),
      maxBytes: clampNumber(args.max_bytes, 1000, 500000, 200000),
      limit: clampNumber(args.max_results, 1, 500, 100)
    });
    return formatCodeSymbolResults(results);
  }

  if (name === 'write_file') {
    const target = await resolveWorkspacePath(cwd, args.path, { mustExist: false });
    await assertWorkspaceWriteAllowed(cwd, target);
    const mode = args.mode === 'append' ? 'append' : 'overwrite';
    const content = String(args.content ?? '');
    const relativePath = path.relative(cwd, target);
    const before = await readExistingText(target);
    const after = mode === 'append' ? `${before ?? ''}${content}` : content;
    if (before === null) {
      await confirm(rl, assumeYes, `Write ${content.length} bytes to ${relativePath} (${mode})?`);
    } else {
      await confirm(
        rl,
        assumeYes,
        `Proposed change:\n${createUnifiedDiff(relativePath, before, after)}Apply change?`
      );
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, after);
    return `Wrote ${relativePath} (${content.length} bytes).`;
  }

  if (name === 'replace_in_file') {
    const target = await resolveWorkspacePath(cwd, args.path, { mustExist: true, file: true });
    await assertWorkspaceWriteAllowed(cwd, target);
    const search = String(args.search ?? '');
    const replace = String(args.replace ?? '');
    if (!search) throw new Error('replace_in_file requires a non-empty search string');
    const before = await fs.readFile(target, 'utf8');
    const count = before.split(search).length - 1;
    if (count === 0) throw new Error('search string was not found');
    const after = before.replaceAll(search, replace);
    const relativePath = path.relative(cwd, target);
    await confirm(
      rl,
      assumeYes,
      `Proposed change:\n${createUnifiedDiff(relativePath, before, after)}Apply change?`
    );
    await fs.writeFile(target, after);
    return `Updated ${relativePath} (${count} replacement(s)).`;
  }

  if (name === 'apply_patch') {
    const patch = String(args.patch ?? '');
    if (!patch.trim()) throw new Error('apply_patch requires a unified patch');
    await assertWorkspacePatchAllowed(cwd, patch);
    await runGitApply(cwd, patch, ['--check', '--whitespace=nowarn', '-']);
    await confirm(rl, assumeYes, `Apply unified patch?\n${trimPatchForPrompt(patch)}`);
    await runGitApply(cwd, patch, ['--whitespace=nowarn', '-']);
    return 'Applied patch.';
  }

  if (name === 'run_shell') {
    const command = String(args.command ?? '').trim();
    if (!command) throw new Error('run_shell requires a command');
    const policy = await evaluateWorkspaceCommandPolicy(cwd, command);
    if (policy === 'disabled') throw new Error('blocked by command safety policy');
    await confirm(rl, assumeYes, `Run shell command in ${cwd}: ${command}`);
    const timeout = clampNumber(args.timeout_ms, 1000, 300000, 60000);
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      env: createSubprocessEnv(process.env),
      shell: process.env.SHELL || '/bin/sh'
    });
    return trimOutput([stdout, stderr].filter(Boolean).join('\n'));
  }

  if (name === 'start_shell_session') {
    const id = String(args.id ?? '').trim();
    await confirm(rl, assumeYes, `Start shell session${id ? ` "${id}"` : ''} in ${cwd}?`);
    return formatShellSessionStarted(startShellSession(cwd, { id }));
  }

  if (name === 'send_shell_session') {
    const id = String(args.id ?? '').trim();
    const command = String(args.command ?? '').trim();
    if (!id) throw new Error('send_shell_session requires a session id');
    if (!command) throw new Error('send_shell_session requires a command');
    const policy = await evaluateWorkspaceCommandPolicy(cwd, command);
    if (policy === 'disabled') throw new Error('blocked by command safety policy');
    await confirm(rl, assumeYes, `Run shell command in session "${id}": ${command}`);
    const result = await sendShellSessionCommand(id, command, {
      timeoutMs: clampNumber(args.timeout_ms, 1000, 300000, 30000)
    });
    return formatShellSessionCommand(result);
  }

  if (name === 'read_shell_session') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('read_shell_session requires a session id');
    return formatShellSessionRead(readShellSession(id));
  }

  if (name === 'list_shell_sessions') {
    return formatShellSessionList(listShellSessions());
  }

  if (name === 'stop_shell_session') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('stop_shell_session requires a session id');
    await confirm(rl, assumeYes, `Stop shell session "${id}"?`);
    return formatShellSessionStopped(stopShellSession(id));
  }

  if (name === 'run_package_script') {
    const script = String(args.script ?? '').trim();
    if (!/^[\w:-]+$/.test(script)) throw new Error('run_package_script requires a simple script name');
    const packageJson = await readPackageJson(cwd);
    if (!packageJson?.scripts?.[script]) throw new Error(`package script not found: ${script}`);
    const packageManager = await detectPackageManager(cwd);
    const command = `${packageManager} run ${script}`;
    await confirm(rl, assumeYes, `Run package script in ${cwd}: ${command}`);
    const timeout = clampNumber(args.timeout_ms, 1000, 300000, 120000);
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      env: createSubprocessEnv(process.env),
      shell: process.env.SHELL || '/bin/sh'
    });
    return trimOutput([stdout, stderr].filter(Boolean).join('\n'));
  }

  if (name === 'git_summary') {
    return formatGitSummary(await gitSummary(cwd));
  }

  if (name === 'git_status') {
    return gitStatus(cwd);
  }

  if (name === 'git_diff') {
    const filePath = args.path ? path.relative(cwd, await resolveWorkspacePath(cwd, args.path)) : '';
    return gitDiff(cwd, filePath);
  }

  if (name === 'mcp_list_tools') {
    if (config.localOnly) throw new Error('mcp_list_tools is disabled in local-only mode');
    return formatWorkspaceMcpTools(await listWorkspaceMcpTools(cwd));
  }

  if (name === 'mcp_call_tool') {
    if (config.localOnly) throw new Error('mcp_call_tool is disabled in local-only mode');
    const serverName = String(args.server ?? '').trim();
    const toolName = String(args.tool ?? '').trim();
    if (!serverName) throw new Error('mcp_call_tool requires a server name');
    if (!toolName) throw new Error('mcp_call_tool requires a tool name');
    const result = await callWorkspaceMcpTool({
      cwd,
      serverName,
      toolName,
      args: args.arguments && typeof args.arguments === 'object' ? args.arguments : {}
    });
    return formatMcpToolCallResult(result);
  }

  if (name === 'quality_gate') {
    await confirm(rl, assumeYes, `Run quality gate in ${cwd}?`);
    return runQualityGate(cwd, {
      timeoutMs: clampNumber(args.timeout_ms, 1000, 300000, 300000)
    });
  }

  if (name === 'create_checkpoint') {
    const checkpointName = String(args.name ?? '').trim() || 'checkpoint';
    await confirm(rl, assumeYes, `Create checkpoint "${checkpointName}" in ${cwd}?`);
    return formatCheckpointCreated(await createCheckpoint(cwd, { name: checkpointName }));
  }

  if (name === 'list_checkpoints') {
    return formatCheckpointList(await listCheckpoints(cwd));
  }

  if (name === 'restore_checkpoint') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('restore_checkpoint requires a checkpoint id');
    await confirm(rl, assumeYes, `Restore checkpoint "${id}" in ${cwd}?`);
    return formatCheckpointRestored(await restoreCheckpoint(cwd, id));
  }

  if (name === 'add_task') {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('add_task requires a title');
    await confirm(rl, assumeYes, `Add task "${title}" in ${cwd}?`);
    const added = await addTask(cwd, {
      title,
      priority: args.priority,
      dependsOn: args.depends_on ?? args.dependsOn,
      labels: args.labels,
      notes: args.notes ?? args.note
    });
    const task = await getTask(cwd, added.id);
    return args.json ? formatTaskDetailsJson(task) : formatTaskAdded(added);
  }

  if (name === 'list_tasks') {
    const tasks = await listTasks(cwd, {
      status: args.status,
      priority: args.priority,
      label: args.label
    });
    return args.json ? formatTaskListJson(tasks) : formatTaskList(tasks);
  }

  if (name === 'show_task') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('show_task requires a task id');
    const task = await getTask(cwd, id);
    return args.json ? formatTaskDetailsJson(task) : formatTaskDetails(task);
  }

  if (name === 'update_task') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('update_task requires a task id');
    const updates = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.depends_on !== undefined || args.dependsOn !== undefined) updates.dependsOn = args.depends_on ?? args.dependsOn;
    if (args.labels !== undefined) updates.labels = args.labels;
    if (args.notes !== undefined || args.note !== undefined) updates.notes = args.notes ?? args.note;
    await confirm(rl, assumeYes, `Update task "${id}" in ${cwd}?`);
    const updated = await updateTask(cwd, id, updates);
    const task = await getTask(cwd, updated.id);
    return args.json ? formatTaskDetailsJson(task) : formatTaskUpdated(updated);
  }

  if (name === 'complete_task') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('complete_task requires a task id');
    await confirm(rl, assumeYes, `Complete task "${id}" in ${cwd}?`);
    const completed = await completeTask(cwd, id);
    const task = await getTask(cwd, completed.id);
    return args.json ? formatTaskDetailsJson(task) : formatTaskCompleted(completed);
  }

  if (name === 'reopen_task') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('reopen_task requires a task id');
    await confirm(rl, assumeYes, `Reopen task "${id}" in ${cwd}?`);
    const reopened = await reopenTask(cwd, id);
    const task = await getTask(cwd, reopened.id);
    return args.json ? formatTaskDetailsJson(task) : formatTaskReopened(reopened);
  }

  if (name === 'start_worker') {
    const taskId = String(args.task_id ?? '').trim();
    const command = String(args.command ?? '').trim();
    const id = String(args.id ?? '').trim();
    if (!taskId) throw new Error('start_worker requires a task id');
    if (!command) throw new Error('start_worker requires a command');
    const policy = await evaluateWorkspaceCommandPolicy(cwd, command);
    if (policy === 'disabled') throw new Error('blocked by command safety policy');
    await confirm(rl, assumeYes, `Start worker${id ? ` "${id}"` : ''} for task "${taskId}": ${command}`);
    return formatWorkerStarted(await startWorker(cwd, { taskId, command, id }));
  }

  if (name === 'start_app') {
    const script = String(args.script ?? '').trim();
    const id = String(args.id ?? '').trim();
    await confirm(rl, assumeYes, `Start app${script ? ` script "${script}"` : ''} in ${cwd}?`);
    return formatAppStart(await startApp(cwd, { script, id }));
  }

  if (name === 'start_agent_worker') {
    const taskId = String(args.task_id ?? '').trim();
    const prompt = String(args.prompt ?? '').trim();
    const id = String(args.id ?? '').trim();
    if (!taskId) throw new Error('start_agent_worker requires a task id');
    if (!prompt) throw new Error('start_agent_worker requires a prompt');
    await confirm(rl, assumeYes, `Start Codex agent${id ? ` "${id}"` : ''} for task "${taskId}"?`);
    return formatWorkerStarted(await startAgentWorker(cwd, {
      taskId,
      prompt,
      id,
      model: args.model
    }));
  }

  if (name === 'send_agent_message') {
    const id = String(args.id ?? '').trim();
    const message = String(args.message ?? '').trim();
    if (!id) throw new Error('send_agent_message requires a worker id');
    if (!message) throw new Error('send_agent_message requires a message');
    await confirm(rl, assumeYes, `Send follow-up message to agent "${id}"?`);
    return formatAgentMessageSent(await sendAgentMessage(cwd, id, message));
  }

  if (name === 'list_workers') {
    const workers = await listWorkers(cwd, { taskId: args.task_id });
    return args.json ? formatWorkerListJson(workers) : formatWorkerList(workers);
  }

  if (name === 'agent_dashboard') {
    const dashboard = await createAgentDashboard(cwd, { taskId: args.task_id });
    return args.json ? formatAgentDashboardJson(dashboard) : formatAgentDashboard(dashboard);
  }

  if (name === 'agent_dashboard_html') {
    return formatBrowserDashboard(await createBrowserDashboard(cwd, config, { taskId: args.task_id }));
  }

  if (name === 'read_worker') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('read_worker requires a worker id');
    const worker = await readWorker(cwd, id, {
      maxBytes: args.max_bytes,
      tailLines: args.tail_lines
    });
    if (args.json) return formatWorkerReadJson(worker, { clean: args.clean });
    return args.clean ? formatWorkerReadClean(worker) : formatWorkerRead(worker);
  }

  if (name === 'stop_worker') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('stop_worker requires a worker id');
    await confirm(rl, assumeYes, `Stop worker "${id}"?`);
    return formatWorkerStopped(await stopWorker(cwd, id));
  }

  if (name === 'prune_workers') {
    const includeRunning = Boolean(args.include_running);
    const failedOnly = Boolean(args.failed_only);
    let confirmationMessage = 'Remove completed worker records and logs?';
    if (includeRunning) {
      confirmationMessage = 'Stop and remove all worker records and logs, including running workers?';
    }
    if (failedOnly) {
      confirmationMessage = 'Remove failed worker records and logs?';
    }
    await confirm(rl, assumeYes, confirmationMessage);
    const pruned = await pruneWorkers(cwd, { includeRunning, failedOnly });
    return args.json ? formatWorkerPrunedJson(pruned) : formatWorkerPruned(pruned);
  }

  if (name === 'list_hooks') {
    return formatHookList(await listHooks(cwd));
  }

  if (name === 'init_harness') {
    const force = Boolean(args.force);
    await confirm(rl, assumeYes, `${force ? 'Replace' : 'Create'} .codepark/hooks.json in ${cwd}?`);
    return formatHarnessInit(await initHarness(cwd, { force }));
  }

  if (name === 'install_launcher') {
    const target = String(args.target ?? '').trim();
    const force = Boolean(args.force);
    await confirm(rl, assumeYes, `${force ? 'Replace' : 'Create'} launcher${target ? ` "${target}"` : ''} in ${cwd}?`);
    return formatLauncherInstall(await installLauncher(cwd, { target, force }));
  }

  if (name === 'run_hook') {
    const hookName = String(args.name ?? '').trim();
    if (!hookName) throw new Error('run_hook requires a hook name');
    await confirm(rl, assumeYes, `Run hook "${hookName}" in ${cwd}?`);
    return formatHookRun(await runHook(cwd, hookName, {
      timeoutMs: clampNumber(args.timeout_ms, 1000, 300000, 120000)
    }));
  }

  if (name === 'list_skills') {
    return formatLocalSkillList(await listLocalSkills(cwd, args.query ?? ''));
  }

  if (name === 'read_skill') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('read_skill requires a skill id');
    return formatLocalSkill(await readLocalSkill(cwd, id));
  }

  if (name === 'pack_skill') {
    const id = String(args.id ?? '').trim();
    if (!id) throw new Error('pack_skill requires a skill id');
    const outputPath = await resolveWorkspacePath(cwd, args.output_path, { mustExist: false });
    await confirm(rl, assumeYes, `Pack local skill "${id}" to ${path.relative(cwd, outputPath)}?`);
    return formatPackedSkill(await packLocalSkill(cwd, id, outputPath));
  }

  if (name === 'install_skill_package') {
    const packagePath = await resolveWorkspacePath(cwd, args.package_path, { mustExist: true, file: true });
    const skillId = String(args.skill_id ?? '').trim();
    await confirm(
      rl,
      assumeYes,
      `Install skill package ${path.relative(cwd, packagePath)}${skillId ? ` as "${skillId}"` : ''}?`
    );
    return formatInstalledSkillPackage(await installSkillPackage(cwd, packagePath, {
      id: skillId,
      overwrite: Boolean(args.overwrite)
    }));
  }

  throw new Error(`unknown tool: ${name}`);
}

function runGitApply(cwd, patch, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['apply', ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(trimOutput(stderr || stdout || `git apply failed with code ${code}`)));
    });
    child.stdin.end(patch);
  });
}

function trimPatchForPrompt(patch) {
  const max = 20000;
  return patch.length > max ? `${patch.slice(0, max)}\n[patch truncated in prompt]` : patch;
}

async function confirm(rl, assumeYes, prompt) {
  if (assumeYes) return;
  if (!rl) throw new Error(`confirmation required: ${prompt}`);
  const answer = await rl.question(`${prompt} [y/N] `);
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new Error('user denied tool action');
  }
}

async function readExistingText(target) {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function trimOutput(value) {
  const max = 60000;
  if (!value) return '[command completed with no output]';
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value;
}

function sortObjectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

function toolSchemas(options = {}) {
  const schemas = [
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to the workspace.' },
            max_depth: { type: 'integer', minimum: 1, maximum: 5 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a UTF-8 text file from the workspace.',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string' },
            max_bytes: { type: 'integer', minimum: 1000, maximum: 200000 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_notebook',
        description: 'Read a Jupyter notebook (.ipynb) and render a compact cell summary.',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Notebook path relative to the workspace.' },
            max_bytes: { type: 'integer', minimum: 10000, maximum: 2000000 },
            max_cells: { type: 'integer', minimum: 1, maximum: 200 },
            include_outputs: { type: 'boolean', description: 'Include captured output text for code cells when available.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'image_info',
        description: 'Read a local image file and return basic metadata like mime type and dimensions. Read-only.',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Image path relative to the workspace.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch a URL over HTTP(S) with size/time limits. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string' },
            method: { type: 'string', description: 'HTTP method (default GET).' },
            headers: { type: 'object', description: 'Optional request headers.' },
            timeout_ms: { type: 'integer', minimum: 1000, maximum: 120000 },
            max_bytes: { type: 'integer', minimum: 1000, maximum: 2000000 },
            follow_redirects: { type: 'boolean' },
            json: { type: 'boolean', description: 'Return structured JSON instead of formatted text.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'project_overview',
        description: 'Summarize project package metadata, scripts, and dependencies.',
        parameters: {
          type: 'object',
          properties: {
            scripts_only: { type: 'boolean' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_profile',
        description: 'Read the local .codepark/profile.json workspace profile if configured.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'workspace_plan',
        description: 'Inspect the workspace app type, launch command, inferred hooks, profile, launcher, container runtime, and next setup actions. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            json: { type: 'boolean', description: 'Return structured JSON instead of formatted text.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'workspace_boot',
        description: 'Initialize missing local harness files, optionally start the app as a managed worker, and write the local browser dashboard. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            start: { type: 'boolean', description: 'Start the detected app command as a managed worker. Defaults to true.' },
            id: { type: 'string', description: 'Optional worker id when starting the app.' },
            json: { type: 'boolean', description: 'Return structured JSON instead of formatted text.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_policy',
        description: 'Read the active workspace policy that constrains writes and shell commands.',
        parameters: {
          type: 'object',
          properties: {
            json: { type: 'boolean', description: 'Return structured JSON instead of formatted text.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'check_policy',
        description: 'Check whether a write path or shell command is allowed by active workspace policy.',
        parameters: {
          type: 'object',
          required: ['type', 'value'],
          properties: {
            type: { type: 'string', enum: ['write', 'command'] },
            value: { type: 'string', description: 'Workspace path for write checks or shell command for command checks.' },
            json: { type: 'boolean', description: 'Return structured JSON instead of formatted text.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_policy_presets',
        description: 'List available workspace policy presets.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_policy_preset',
        description: 'Apply a named workspace policy preset to .codepark/profile.json. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['preset'],
          properties: {
            preset: { type: 'string', enum: listWorkspacePolicyPresets() },
            force: { type: 'boolean', description: 'Update policy in an existing .codepark/profile.json file.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'init_profile',
        description: 'Create a local .codepark/profile.json with inferred hooks and runtime preferences. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            force: { type: 'boolean', description: 'Replace an existing .codepark/profile.json file.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'container_runtime',
        description: 'Detect local container runtime support, preferring Podman when available and falling back to Docker.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'compose_start',
        description: 'Start Podman/Docker Compose as a durable CodePark worker, preferring Podman when available. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            detached: { type: 'boolean', description: 'Run compose up -d so containers continue detached.' },
            id: { type: 'string', description: 'Optional worker id using letters, numbers, dot, underscore, and dash.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'compose_stop',
        description: 'Run Podman/Docker Compose down for the workspace. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'doctor',
        description: 'Report CodePark provider setup and active-workspace workflow diagnostics. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            mcp_health: {
              type: 'boolean',
              description: 'When true, launch configured MCP servers and list tools to check health.'
            },
            json: { type: 'boolean', description: 'Return structured JSON instead of the compact text report.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'readiness',
        description: 'Report CodePark endpoint mode, local-use readiness, and secure-harness readiness. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            json: { type: 'boolean', description: 'Return structured JSON instead of the compact text report.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'project_assessment',
        description: 'Summarize local testing readiness, secure-harness posture, workspace launch state, gaps, and next actions. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            json: { type: 'boolean', description: 'Return structured JSON instead of the compact text report.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_assessment_tasks',
        description: 'Create local task-ledger items for current project assessment gaps. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            force: { type: 'boolean', description: 'Create tasks even when matching assessment task titles already exist.' },
            json: { type: 'boolean', description: 'Return structured JSON instead of the compact text report.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'find_files',
        description: 'Find files by a glob pattern inside the workspace.',
        parameters: {
          type: 'object',
          required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Glob pattern such as **/*.js or package.json.' },
            path: { type: 'string', description: 'Directory path relative to the workspace.' },
            max_results: { type: 'integer', minimum: 1, maximum: 500 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_text',
        description: 'Search text files in the workspace for a literal string or regex.',
        parameters: {
          type: 'object',
          required: ['pattern'],
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string', description: 'Directory path relative to the workspace.' },
            regex: { type: 'boolean' },
            case_sensitive: { type: 'boolean' },
            max_matches: { type: 'integer', minimum: 1, maximum: 500 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'code_index',
        description: 'Build a local read-only source-code index with files, definitions, and imports. Useful before editing unfamiliar projects.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to the workspace.' },
            max_files: { type: 'integer', minimum: 1, maximum: 1000 },
            max_bytes: { type: 'integer', minimum: 1000, maximum: 500000 },
            max_symbols: { type: 'integer', minimum: 1, maximum: 200 },
            include_imports: { type: 'boolean', description: 'Include import/dependency lines in the formatted output.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'find_code_symbols',
        description: 'Search the local source-code index for definitions by symbol name, kind, or path. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Symbol name, signature text, or file path fragment to search for.' },
            path: { type: 'string', description: 'Directory path relative to the workspace.' },
            kind: { type: 'string', description: 'Optional symbol kind such as function, class, variable, method, or import.' },
            max_files: { type: 'integer', minimum: 1, maximum: 1000 },
            max_bytes: { type: 'integer', minimum: 1000, maximum: 500000 },
            max_results: { type: 'integer', minimum: 1, maximum: 500 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a workspace file. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            mode: { type: 'string', enum: ['overwrite', 'append'] }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_in_file',
        description: 'Replace exact text in a workspace file. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['path', 'search', 'replace'],
          properties: {
            path: { type: 'string' },
            search: { type: 'string' },
            replace: { type: 'string' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_patch',
        description: 'Apply a unified patch to workspace files after validation. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['patch'],
          properties: {
            patch: { type: 'string', description: 'Unified diff text accepted by git apply.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_shell',
        description: 'Run a shell command in the workspace. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['command'],
          properties: {
            command: { type: 'string' },
            timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'start_shell_session',
        description: 'Start a persistent shell session in the workspace. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Optional session id using letters, numbers, dot, underscore, and dash.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'send_shell_session',
        description: 'Send a command to a persistent shell session. Preserves shell state and requires user approval.',
        parameters: {
          type: 'object',
          required: ['id', 'command'],
          properties: {
            id: { type: 'string', description: 'Shell session id.' },
            command: { type: 'string', description: 'Shell command to run in the session.' },
            timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_shell_session',
        description: 'Read unread output from a persistent shell session.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Shell session id.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_shell_sessions',
        description: 'List running persistent shell sessions.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stop_shell_session',
        description: 'Stop a persistent shell session. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Shell session id.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_package_script',
        description: 'Run a named package.json script through the detected package manager. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['script'],
          properties: {
            script: { type: 'string', description: 'Package script name such as test, build, or dev.' },
            timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'git_summary',
        description: 'Show read-only git branch, status, and recent commit summary for the workspace.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Show read-only git status for the workspace.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'git_diff',
        description: 'Show read-only unstaged git diff for the workspace or a workspace-relative file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'mcp_list_tools',
        description: 'Launch configured workspace MCP servers and list their tools.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'mcp_call_tool',
        description: 'Call a tool on a configured workspace MCP server.',
        parameters: {
          type: 'object',
          required: ['server', 'tool'],
          properties: {
            server: { type: 'string', description: 'Configured MCP server name from .codepark.mcp.json.' },
            tool: { type: 'string', description: 'MCP tool name to call.' },
            arguments: { type: 'object', description: 'Tool arguments object.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'quality_gate',
        description: 'Run the project quality gate using package scripts, preferring verify then check/lint/typecheck/test. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_checkpoint',
        description: 'Create a local git patch checkpoint under .codepark/checkpoints. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Human-readable checkpoint name.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_checkpoints',
        description: 'List local CodePark checkpoints in this workspace.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'restore_checkpoint',
        description: 'Restore a local CodePark checkpoint by exact id, unique prefix, or name. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Checkpoint id, unique prefix, or name.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_task',
        description: 'Add a local CodePark task to .codepark/tasks.json. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', description: 'Task title.' },
            priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Optional task priority. Defaults to normal.' },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional exact task ids or unique prefixes this task depends on. Stored as exact ids.'
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional labels for grouping or filtering tasks.'
            },
            notes: { type: 'string', description: 'Optional task notes.' },
            json: { type: 'boolean', description: 'Return structured JSON task metadata.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_tasks',
        description: 'List local CodePark tasks.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['open', 'done', 'blocked'], description: 'Optional task status filter. blocked is derived from open tasks with unfinished dependencies.' },
            priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Optional priority filter.' },
            label: { type: 'string', description: 'Optional label filter.' },
            json: { type: 'boolean', description: 'Return structured JSON task list metadata.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'show_task',
        description: 'Show full local CodePark task metadata by exact id or unique prefix.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Task id or unique prefix.' },
            json: { type: 'boolean', description: 'Return structured JSON task metadata.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_task',
        description: 'Update local CodePark task metadata by exact id or unique prefix. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Task id or unique prefix.' },
            title: { type: 'string', description: 'Optional replacement task title.' },
            priority: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Optional task priority.' },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional replacement dependency ids or unique prefixes. Stored as exact ids.'
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional replacement labels.'
            },
            notes: { type: 'string', description: 'Optional replacement task notes. Empty clears notes.' },
            json: { type: 'boolean', description: 'Return structured JSON task metadata.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'complete_task',
        description: 'Mark a local CodePark task done by exact id or unique prefix. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Task id or unique prefix.' },
            json: { type: 'boolean', description: 'Return structured JSON task metadata.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reopen_task',
        description: 'Mark a done local CodePark task open again by exact id or unique prefix. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Task id or unique prefix.' },
            json: { type: 'boolean', description: 'Return structured JSON task metadata.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'start_worker',
        description: 'Start a durable background shell worker scoped to an open CodePark task. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['task_id', 'command'],
          properties: {
            task_id: { type: 'string', description: 'Task id or unique prefix.' },
            command: { type: 'string', description: 'Shell command to run in the background.' },
            id: { type: 'string', description: 'Optional worker id using letters, numbers, dot, underscore, and dash.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'start_app',
        description: 'Detect a package app launch script and start it as a durable CodePark worker. Creates the task automatically. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'Optional package script to run. Defaults to dev, start, serve, then preview.' },
            id: { type: 'string', description: 'Optional worker id using letters, numbers, dot, underscore, and dash.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'start_agent_worker',
        description: 'Start a task-scoped Codex CLI background agent tied to an open CodePark task. The agent stays alive and resumes the same Codex session for follow-ups. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['task_id', 'prompt'],
          properties: {
            task_id: { type: 'string', description: 'Task id or unique prefix.' },
            prompt: { type: 'string', description: 'Instruction for the background Codex agent.' },
            id: { type: 'string', description: 'Optional worker id using letters, numbers, dot, underscore, and dash.' },
            model: { type: 'string', description: 'Optional Codex CLI model override.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'send_agent_message',
        description: 'Send a follow-up message to a running task-scoped Codex background agent session. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['id', 'message'],
          properties: {
            id: { type: 'string', description: 'Agent worker id or unique prefix.' },
            message: { type: 'string', description: 'Follow-up instruction to deliver to the agent.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_workers',
        description: 'List durable background workers, optionally filtered by task id prefix.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Optional task id or prefix.' },
            json: { type: 'boolean', description: 'Return structured JSON instead of the compact text list.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'agent_dashboard',
        description: 'Show a read-only dashboard of local tasks, background agents, inbox last messages, session ids, and recent logs.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Optional task id or prefix.' },
            json: { type: 'boolean', description: 'Return structured JSON instead of the compact text dashboard.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'agent_dashboard_html',
        description: 'Write a local static HTML dashboard for tasks, agents, workers, readiness, and policy state.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Optional task id or prefix.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_worker',
        description: 'Read the latest log output for a background worker.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Worker id or unique prefix.' },
            max_bytes: { type: 'integer', minimum: 1000, maximum: 120000 },
            tail_lines: { type: 'integer', minimum: 1, description: 'Return only the last N log lines after byte truncation.' },
            clean: { type: 'boolean', description: 'Suppress raw Codex JSON event lines and show a concise readable log view.' },
            json: { type: 'boolean', description: 'Return structured worker metadata with log output.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stop_worker',
        description: 'Stop a running background worker. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Worker id or unique prefix.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'prune_workers',
        description: 'Remove completed background worker records and logs. Running workers are kept unless include_running is true. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            include_running: {
              type: 'boolean',
              description: 'Also stop and remove running or starting workers.'
            },
            failed_only: {
              type: 'boolean',
              description: 'Remove only failed worker records and logs.'
            },
            json: {
              type: 'boolean',
              description: 'Return structured JSON with removed and kept worker metadata.'
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_hooks',
        description: 'List named hooks from .codepark/hooks.json.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'init_harness',
        description: 'Infer package scripts and create .codepark/hooks.json so CodePark can act as this app harness. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            force: { type: 'boolean', description: 'Replace an existing .codepark/hooks.json file.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'install_launcher',
        description: 'Write a clickable local launcher file for this workspace. Requires user approval.',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Relative launcher path. Defaults to CodePark.command.' },
            force: { type: 'boolean', description: 'Replace an existing launcher file.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_hook',
        description: 'Run a named hook from .codepark/hooks.json. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Hook name or unique prefix.' },
            timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_skills',
        description: 'List local markdown skills from .codepark/skills.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional search text.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_skill',
        description: 'Read a local markdown skill by id from .codepark/skills.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Skill id or unique prefix from list_skills.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'pack_skill',
        description: 'Package one local markdown skill into a shareable CodePark skill package JSON file. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['id', 'output_path'],
          properties: {
            id: { type: 'string', description: 'Local skill id or unique prefix from list_skills.' },
            output_path: { type: 'string', description: 'Package JSON path relative to the workspace.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'install_skill_package',
        description: 'Install a CodePark skill package JSON file into .codepark/skills. Requires user approval.',
        parameters: {
          type: 'object',
          required: ['package_path'],
          properties: {
            package_path: { type: 'string', description: 'Package JSON path relative to the workspace.' },
            skill_id: { type: 'string', description: 'Optional local skill id to install as.' },
            overwrite: { type: 'boolean', description: 'Overwrite an existing local skill with the same id.' }
          }
        }
      }
    }
  ];

  if (!options.localOnly) return schemas;

  const disabledToolNames = new Set(['web_fetch', 'mcp_list_tools', 'mcp_call_tool']);
  return schemas
    .filter(schema => !disabledToolNames.has(schema.function?.name))
    .map(schema => {
      if (schema.function?.name !== 'doctor') return schema;
      const { mcp_health: _mcpHealth, ...properties } = schema.function.parameters.properties;
      return {
        ...schema,
        function: {
          ...schema.function,
          parameters: {
            ...schema.function.parameters,
            properties
          }
        }
      };
    });
}

function formatNotebookSummary(notebook, options = {}) {
  const relativePath = String(options.path ?? 'notebook.ipynb');
  const maxCells = Number.isInteger(options.maxCells) ? options.maxCells : 40;
  const includeOutputs = Boolean(options.includeOutputs);

  if (!notebook || typeof notebook !== 'object') throw new Error('notebook JSON was not an object');
  const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
  const metadata = notebook.metadata && typeof notebook.metadata === 'object' ? notebook.metadata : {};
  const language =
    (metadata.kernelspec && typeof metadata.kernelspec === 'object' && metadata.kernelspec.language) ||
    (metadata.language_info && typeof metadata.language_info === 'object' && metadata.language_info.name) ||
    '';

  const lines = [];
  lines.push(relativePath);
  lines.push('');
  lines.push('Notebook summary:');
  lines.push(`- cells: ${cells.length}`);
  if (language) lines.push(`- language: ${String(language)}`);
  lines.push('');

  const slice = cells.slice(0, maxCells);
  for (let i = 0; i < slice.length; i += 1) {
    const cell = slice[i];
    const cellType = cell && typeof cell === 'object' ? String(cell.cell_type ?? 'unknown') : 'unknown';
    lines.push(`Cell ${i + 1} (${cellType})`);

    const source = cell && typeof cell === 'object' ? cell.source : '';
    const text = Array.isArray(source) ? source.join('') : String(source ?? '');
    const trimmed = text.trimEnd();
    if (trimmed) {
      lines.push(trimmed.length > 1500 ? `${trimmed.slice(0, 1500)}\n...` : trimmed);
    } else {
      lines.push('[empty]');
    }

    if (includeOutputs && cellType === 'code' && cell && typeof cell === 'object' && Array.isArray(cell.outputs)) {
      const outputText = cell.outputs
        .map(output => {
          if (!output || typeof output !== 'object') return '';
          const streamText = output.text;
          if (Array.isArray(streamText)) return streamText.join('');
          if (typeof streamText === 'string') return streamText;
          const dataText = output.data && typeof output.data === 'object' ? output.data['text/plain'] : '';
          if (Array.isArray(dataText)) return dataText.join('');
          if (typeof dataText === 'string') return dataText;
          return '';
        })
        .map(chunk => chunk.trimEnd())
        .filter(Boolean)
        .join('\n');
      if (outputText) {
        lines.push('');
        lines.push('Output:');
        lines.push(outputText.length > 1500 ? `${outputText.slice(0, 1500)}\n...` : outputText);
      }
    }

    if (i !== slice.length - 1) lines.push('');
  }

  if (cells.length > slice.length) {
    lines.push('');
    lines.push(`[truncated after ${slice.length} cells]`);
  }

  return lines.join('\n');
}
