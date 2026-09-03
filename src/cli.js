import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';
import { promisify } from 'node:util';
import { parseShellWords as parseShell, quoteShellWords as quote } from './shellSyntax.js';
import { askAgent } from './agent.js';
import {
  createAssessmentTasks,
  createProjectAssessment,
  formatAssessmentTasks,
  formatAssessmentTasksJson,
  formatProjectAssessment,
  formatProjectAssessmentJson
} from './assessment.js';
import { formatAppStart, startApp } from './appLauncher.js';
import { createCodeIndex, findCodeSymbols, formatCodeIndex, formatCodeSymbolResults } from './codeIntelligence.js';
import { configFileExists, isLocalOnlyBaseUrl, loadConfig, maskConfig, modelAuthStatus, saveConfig } from './config.js';
import {
  detectContainerRuntime,
  formatComposeStart,
  formatComposeStop,
  formatContainerRuntime,
  startCompose,
  stopCompose
} from './containerRuntime.js';
import { compactHistory, compactHistoryIfNeeded, formatTokenBudget } from './context.js';
import {
  createAgentDashboard,
  createBrowserDashboard,
  formatAgentDashboard,
  formatAgentDashboardJson,
  formatBrowserDashboard
} from './dashboard.js';
import { isBareSelfReference } from './inputIntent.js';
import { formatDoctorReport, formatDoctorReportJson, runDoctor } from './doctor.js';
import { gitDiff, gitSummary, formatGitSummary } from './git.js';
import { formatHarnessInit, initHarness } from './harness.js';
import { buildCodeParkShellCommand, formatLauncherInstall, installLauncher } from './launcher.js';
import { formatLocalInstall, installLocal } from './localInstall.js';
import { callWorkspaceMcpTool, formatMcpToolCallResult, formatWorkspaceMcpTools, listWorkspaceMcpTools } from './mcp/runtime.js';
import { runOnboarding, shouldRunFirstRunOnboarding } from './onboarding.js';
import { projectOverview } from './project.js';
import { readImageInfo } from './imageInfo.js';
import { createReadinessReport, formatReadinessReport, formatReadinessReportJson } from './readiness.js';
import {
  applyWorkspacePolicyPreset,
  checkWorkspacePolicy,
  createWorkspacePolicyReport,
  formatWorkspacePolicy,
  formatWorkspacePolicyCheck,
  formatWorkspacePolicyCheckJson,
  formatWorkspacePolicyJson,
  formatWorkspacePolicyPreset,
  listWorkspacePolicyPresets
} from './workspacePolicy.js';
import { listProviderProfiles, resolveProviderProfile } from './providers/profiles.js';
import {
  formatWorkspaceProfile,
  formatWorkspaceProfileInit,
  initWorkspaceProfile,
  readWorkspaceProfile
} from './workspaceProfile.js';
import { promptHidden } from './secrets.js';
import { createSelfStatus } from './selfStatus.js';
import { createSessionFile, defaultSessionDir, loadSession, loadSessionList, saveSession, writeSession } from './session/store.js';
import { formatInstalledSkillPackage, formatPackedSkill, installSkillPackage, packLocalSkill } from './skills.js';
import { stopAllShellSessions } from './shellSession.js';
import { CodeParkError, formatJsonError } from './errors.js';
import { webFetch } from './webFetch.js';
import { bootWorkspace, formatWorkspaceBoot, formatWorkspaceBootJson } from './workspaceBoot.js';
import { createWorkspacePlan, formatWorkspacePlan, formatWorkspacePlanJson } from './workspacePlan.js';
import {
  addTask,
  completeTask,
  formatTaskAdded,
  formatTaskCompleted,
  formatTaskDetails,
  formatTaskDetailsJson,
  formatTaskList,
  formatTaskListJson,
  formatTaskReopened,
  formatTaskUpdated,
  getTask,
  listTasks,
  reopenTask,
  updateTask
} from './tasks.js';
import { createTools } from './tools.js';
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

const require = createRequire(import.meta.url);
const packageVersion = require('../package.json').version;
const execFileAsync = promisify(execFile);

const helpText = `CodePark ${packageVersion}

Usage:
  codepark                 Start interactive mode
  codepark ask "prompt"    Run one prompt and exit
  codepark resume [name]   Resume latest or named saved session
  codepark launch [--interactive]
                            Open secure workspace boot in a visible macOS Terminal window
  codepark onboard         Run first-run terminal setup
  codepark install-local [--force] [--bin-dir path]
                            Install/update the local CLI, profile, hooks, and launcher
  codepark init            Write local env, hook, and skill examples
  codepark harness-init [--force]
                            Infer project hooks into .codepark/hooks.json
  codepark launcher-install [--target file] [--force]
                            Write a clickable local launcher
  codepark setup           Securely save local provider and API key config
  codepark providers       List provider profiles
  codepark provider <name> Save a default provider profile
  codepark project         Show package scripts and dependencies
  codepark scripts         Show package scripts
  codepark workspace-plan [--json]
                            Inspect app launch, hooks, profile, and next actions
  codepark workspace-boot [--no-start] [--no-open] [--id id] [--json]
                            Initialize local harness, start app, and write dashboard
  codepark assess [--json] Summarize readiness, secure harness, workspace state, and next actions
  codepark assess-tasks [--json]
                            Write assessment gaps into the local task ledger
  codepark profile         Show .codepark/profile.json if present
  codepark profile-init [--force]
                            Write an inferred workspace profile
  codepark policy [--json] Show active workspace policy
  codepark policy-check write|command <value> [--json]
                            Test a workspace policy decision
  codepark policy-presets  List workspace policy presets
  codepark policy-preset <name> [--force]
                            Apply a workspace policy preset
  codepark container-runtime
                            Detect Podman/Docker support for this workspace
  codepark compose-start [--detached] [--id id]
                            Start Podman/Docker Compose as a managed worker
  codepark compose-stop    Run Podman/Docker Compose down
  codepark web [--method GET] [--header k:v] [--timeout-ms n] [--max-bytes n] [--follow-redirects] <url>
                            Fetch a URL with size/time limits
  codepark image-info <path>
                            Show basic local image metadata
  codepark readiness [--json]
                            Report endpoint and product readiness
  codepark notebook <path> [--include-outputs] [--max-bytes n] [--max-cells n]
                            Render a compact Jupyter notebook summary
  codepark skill-pack <id> <file>
                            Package a local skill for sharing
  codepark skill-install <file> [id]
                            Install a shared skill package
  codepark task-add [--json] [--priority low|normal|high] [--depends-on id] [--label name] [--notes text] <title>
                            Add a local work item
  codepark tasks [open|done|blocked] [--json] [--priority low|normal|high] [--label name]
                            List local work items
  codepark task-show [--json] <id>
                            Show full local work item metadata
  codepark task-update <id> [--json] [--title text] [--priority low|normal|high] [--depends-on id] [--label name] [--notes text]
                            Update a local work item
  codepark task-done [--json] <id>
                            Mark a local work item done
  codepark task-open [--json] <id>
                            Reopen a local work item
  codepark agent-start <task-id> <prompt>
                            Start a task-scoped Codex session agent
  codepark agent-send <worker-id> <message>
                            Send a follow-up message to a running agent
  codepark app-start [script] [--id id]
                            Start dev/start/serve as a managed worker
  codepark worker-start <task-id> <command>
                            Start a task-scoped background worker
  codepark workers [--json] [task-id]
                            List background workers
  codepark dashboard [--json] [task-id]
                            Show task and agent dashboard
  codepark dashboard-html [task-id]
                            Write a local browser dashboard HTML file
  codepark dashboard-open [task-id]
                            Write and open the local browser dashboard
  codepark code-index [query]
                            Show local code symbols, optionally filtered
  codepark worker-read [--clean] [--json] [--tail n] <id>
                            Read background worker logs
  codepark worker-stop <id>
                            Stop a background worker
  codepark worker-prune [--failed] [--json]
                            Remove completed or failed worker records/logs
  codepark config          Print resolved config
  codepark doctor [--json] Check local setup

Flags:
  --cwd <path>              Workspace directory (default: current directory)
  --provider <name>         Provider profile: openai, openrouter, codex, ollama, local
  --model <name>            Model name
  --base-url <url>          OpenAI-compatible base URL
  --json                    Emit structured JSON output (supported commands only)
  --priority <value>        Task priority for task commands: low, normal, high
  --depends-on <id>         Task dependency id/prefix; repeatable
  --label <name>            Task label or list filter; repeatable for task-add/update
  --notes <text>            Task notes for task-add/update
  --title <text>            Task title for task-add/update
  --method <value>          HTTP method for web (default: GET)
  --header <k:v>            HTTP request header for web; repeatable
  --timeout-ms <n>          Web fetch timeout in ms
  --max-bytes <n>           Web fetch maximum bytes to read
  --follow-redirects        Follow up to a small number of redirects
  --include-outputs         Include captured outputs when reading notebooks
  --max-cells <n>           Maximum notebook cells to render
  --bin-dir <path>          Directory for install-local command symlink
  --mcp-health              In doctor, launch MCP servers and list tools
  --local-only              Disable network features (web, MCP) and require a local base URL
  --secure                  Implies --local-only and disables --yes auto-approval
  --no-stream               Disable streaming final responses
  --no-start                Do not start app during workspace-boot
  --no-open                 Do not open the browser dashboard during workspace-boot
  --interactive             For launch, open interactive CodePark instead of workspace boot
  --yes                     Auto-approve guarded tool actions

Environment:
  CODEPARK_API_KEY         Preferred API key
  OPENAI_API_KEY            Fallback API key
  CODEPARK_BASE_URL        Default: https://api.openai.com/v1
  CODEPARK_MODEL           Default model name
  CODEPARK_LOCAL_ONLY      Set to 1/true to disable network features
  CODEPARK_SECURE_MODE     Set to 1/true to require local-only explicit approvals
  CODEPARK_SECRET_STORE    file or keychain
  CODEPARK_CODEX_COMMAND   Codex executable for agent-start (default: codex)
  CODEPARK_CODEX_PROGRESS_INTERVAL_MS
                            Codex heartbeat interval in ms (default: 15000)
  CODEPARK_CONTEXT_LIMIT_TOKENS
                            Default: 120000
  CODEPARK_COMPACT_THRESHOLD_TOKENS
                            Default: 80% of context limit

Interactive commands:
  /help                     Show commands
  /config                   Show resolved config
  /providers                List provider profiles
  /provider <name>          Change provider for this session
  /setup                    Securely save provider and API key config
  /key                      Securely save or update only the API key
  /model <name>             Change model for this session
  /base-url <url>           Change base URL for this session
  /cwd <path>               Change workspace for this session
  /project                  Show package scripts and dependencies
  /scripts                  Show package scripts
  /workspace-plan [--json]  Inspect app launch, hooks, profile, and next actions
  /workspace-boot [--no-start] [--no-open] [--id id] [--json]
                            Initialize local harness, start app, and write dashboard
  /assess [--json]          Summarize readiness, secure harness, workspace state, and next actions
  /assess-tasks [--json]    Write assessment gaps into the local task ledger
  /profile                  Show .codepark/profile.json if present
  /profile-init [--force]   Write an inferred workspace profile
  /policy [--json]          Show active workspace policy
  /policy-check write|command <value> [--json]
                            Test a workspace policy decision
  /policy-presets           List workspace policy presets
  /policy-preset <name> [--force]
                            Apply a workspace policy preset
  /container-runtime        Detect Podman/Docker support
  /compose-start [--detached] [--id id]
                            Start Podman/Docker Compose as a managed worker
  /compose-stop             Run Podman/Docker Compose down
  /find <glob> [path]       Find files by glob
  /grep <text> [path]       Search workspace text
  /web [flags] <url>        Fetch a URL with size/time limits
  /image-info <path>        Show basic local image metadata
  /readiness [--json]       Report endpoint and product readiness
  /notebook <path> [flags]  Render a compact Jupyter notebook summary
  /code-index [query]       Show local code symbols, optionally filtered
  /run <script>             Run a package.json script with approval
  /quality-gate             Run verify/check/lint/typecheck/test with approval
  /harness-init [--force]   Infer project hooks into .codepark/hooks.json
  /launcher-install [--target file] [--force]
                            Write a clickable local launcher
  /ls [path]                List files
  /read <path>              Read a file
  /patch <path>             Apply a unified patch file
  /shell <command>          Run a guarded shell command
  /shell-start [id]         Start a persistent shell session
  /shell-send <id> <cmd>    Send a command to a shell session
  /shell-read <id>          Read new shell session output
  /shells                   List running shell sessions
  /shell-stop <id>          Stop a shell session
  /git                      Show git summary
  /diff [path]              Show unstaged git diff
  /checkpoint [name]        Save a local patch checkpoint
  /checkpoints              List local patch checkpoints
  /restore-checkpoint <id>  Restore a checkpoint by id, prefix, or name
  /task-add [--json] [flags] <title> Add a local work item
  /tasks [open|done|blocked] [flags]
                            List local work items
  /task-show [--json] <id>
                            Show full local work item metadata
  /task-update <id> [--json] [flags] Update a local work item
  /task-done <id> [--json]           Mark a local work item done
  /task-open <id> [--json]           Reopen a local work item
  /agent-start <task-id> <prompt>
                            Start a task-scoped Codex session agent
  /agent-send <worker-id> <message>
                            Send a follow-up message to a running agent
  /app-start [script] [--id id]
                            Start dev/start/serve as a managed worker
  /worker-start <task-id> <command>
                            Start a task-scoped background worker
  /workers [--json] [task-id]
                            List background workers
  /dashboard [--json] [task-id]
                            Show task and agent dashboard
  /dashboard-html [task-id] Write a local browser dashboard HTML file
  /worker-read [--clean] [--json] [--tail n] <id>
                            Read background worker logs
  /worker-stop <id>         Stop a background worker
  /worker-prune [--failed] [--json]
                            Remove completed or failed worker records/logs
  /hooks                    List configured project hooks
  /hook <name>              Run a configured project hook
  /skills [query]           List local markdown skills
  /skill <id>               Read a local markdown skill
  /skill-pack <id> <file>   Package a local skill for sharing
  /skill-install <file> [id]
                            Install a shared skill package
  /save                     Save chat transcript
  /resume [name]            Resume latest or named saved session
  /sessions                 List saved transcripts
  /tokens                   Show estimated context usage
  /compact [keep]           Summarize older history, keeping recent messages
  /mcp                      Launch configured MCP servers and list tools
  /mcp-call <server> <tool> [json]
                            Call a configured MCP tool
  /doctor [--json] [--mcp-health]
                            Check local setup
  /clear                    Clear chat history
  /exit                     Quit
`;

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  let cwd = path.resolve(parsed.flags.cwd ?? process.cwd());
  const stream = parsed.flags.stream !== false;

  if (parsed.command === '--help' || parsed.command === '-h') {
    console.log(helpText);
    return;
  }

  if (parsed.command === '--version' || parsed.command === '-v') {
    console.log(packageVersion);
    return;
  }

  if (parsed.command === 'providers') {
    printProviders();
    return;
  }

  if (parsed.command === 'init') {
    await writeInitialExamples(cwd);
    return;
  }

  if (parsed.command === 'install-local' || parsed.command === 'local-install') {
    console.log(formatLocalInstall(await installLocal(cwd, {
      force: Boolean(parsed.flags.force),
      binDir: parsed.flags.binDir
    })));
    return;
  }

  if (parsed.command === 'harness-init' || parsed.command === 'hook-init') {
    console.log(formatHarnessInit(await initHarness(cwd, { force: Boolean(parsed.flags.force) })));
    return;
  }

  if (parsed.command === 'launcher-install') {
    console.log(formatLauncherInstall(await installLauncher(cwd, {
      target: parsed.flags.target,
      force: Boolean(parsed.flags.force)
    })));
    return;
  }

  if (parsed.command === 'launch') {
    await launchVisibleTerminal({ cwd, flags: parsed.flags });
    return;
  }

  const config = loadConfig(parsed.flags);
  const assumeYes = Boolean(parsed.flags.yes);

  if (config.secureMode && assumeYes) {
    throw new CodeParkError('EDISABLED', '--yes is disabled in secure mode');
  }

  if (config.localOnly && !isLocalOnlyBaseUrl(config.baseUrl)) {
    throw new CodeParkError(
      'ECONFIG',
      'local-only mode requires a local base URL (codex://... or http(s)://localhost)'
    );
  }

  if (parsed.command === 'provider') {
    if (config.localOnly) throw new CodeParkError('EDISABLED', 'provider is disabled in local-only mode');
    const provider = parsed.positionals.join(' ').trim();
    if (!provider) throw new CodeParkError('EARGS', 'provider requires a provider name');
    const next = await saveProviderProfile(provider);
    console.log(`Provider set to ${next.provider}`);
    return;
  }

  if (parsed.command === 'project') {
    console.log(await projectOverview(cwd));
    return;
  }

  if (parsed.command === 'scripts') {
    console.log(await projectOverview(cwd, { scriptsOnly: true }));
    return;
  }

  if (parsed.command === 'workspace-plan') {
    const plan = await createWorkspacePlan(cwd);
    console.log(parsed.flags.json ? formatWorkspacePlanJson(plan) : formatWorkspacePlan(plan));
    return;
  }

  if (parsed.command === 'workspace-boot') {
    const boot = await bootWorkspace(cwd, config, {
      start: !parsed.flags.noStart,
      id: parsed.flags.id
    });
    if (!parsed.flags.noOpen && boot.dashboard?.absolutePath) await openDashboardFile(boot.dashboard.absolutePath);
    console.log(parsed.flags.json ? formatWorkspaceBootJson(boot) : formatWorkspaceBoot(boot));
    return;
  }

  if (parsed.command === 'assess' || parsed.command === 'assessment' || parsed.command === 'audit') {
    const report = await createProjectAssessment(cwd, config);
    console.log(parsed.flags.json ? formatProjectAssessmentJson(report) : formatProjectAssessment(report));
    return;
  }

  if (parsed.command === 'assess-tasks' || parsed.command === 'assessment-tasks' || parsed.command === 'audit-tasks') {
    const result = await createAssessmentTasks(cwd, config, { force: Boolean(parsed.flags.force) });
    console.log(parsed.flags.json ? formatAssessmentTasksJson(result) : formatAssessmentTasks(result));
    return;
  }

  if (parsed.command === 'profile') {
    console.log(formatWorkspaceProfile(await readWorkspaceProfile(cwd)));
    return;
  }

  if (parsed.command === 'profile-init') {
    console.log(formatWorkspaceProfileInit(await initWorkspaceProfile(cwd, { force: Boolean(parsed.flags.force) })));
    return;
  }

  if (parsed.command === 'policy') {
    const report = await createWorkspacePolicyReport(cwd);
    console.log(parsed.flags.json ? formatWorkspacePolicyJson(report) : formatWorkspacePolicy(report));
    return;
  }

  if (parsed.command === 'policy-check') {
    const type = parsed.positionals[0];
    const value = parsed.positionals.slice(1).join(' ').trim();
    if (!type || !value) throw new CodeParkError('EARGS', 'policy-check requires write|command and a value');
    const result = await checkWorkspacePolicy(cwd, type, value);
    console.log(parsed.flags.json ? formatWorkspacePolicyCheckJson(result) : formatWorkspacePolicyCheck(result));
    return;
  }

  if (parsed.command === 'policy-presets') {
    console.log(`Workspace policy presets\n${listWorkspacePolicyPresets().map(name => `- ${name}`).join('\n')}`);
    return;
  }

  if (parsed.command === 'policy-preset') {
    const preset = parsed.positionals[0];
    if (!preset) throw new CodeParkError('EARGS', 'policy-preset requires a preset name');
    console.log(formatWorkspacePolicyPreset(await applyWorkspacePolicyPreset(cwd, preset, {
      force: Boolean(parsed.flags.force)
    })));
    return;
  }

  if (parsed.command === 'container-runtime') {
    console.log(formatContainerRuntime(await detectContainerRuntime(cwd)));
    return;
  }

  if (parsed.command === 'compose-start') {
    console.log(formatComposeStart(await startCompose(cwd, {
      detached: Boolean(parsed.flags.detached),
      id: parsed.flags.id
    })));
    return;
  }

  if (parsed.command === 'compose-stop') {
    console.log(formatComposeStop(await stopCompose(cwd)));
    return;
  }

  if (parsed.command === 'web') {
    if (config.localOnly) throw new CodeParkError('EDISABLED', 'web is disabled in local-only mode');
    const url = parsed.positionals[0];
    if (!url) throw new CodeParkError('EARGS', 'web requires a URL');
    const headers = parseHeaderFlags(parsed.flags.headers);
    const result = await webFetch(url, {
      method: parsed.flags.method,
      headers,
      timeoutMs: clampNumber(parsed.flags.timeoutMs, 1000, 120000, 20000),
      maxBytes: clampNumber(parsed.flags.maxBytes, 1000, 2_000_000, 200000),
      followRedirects: Boolean(parsed.flags.followRedirects)
    });
    if (parsed.flags.json) console.log(formatWebFetchJson(url, result));
    else console.log(formatWebFetchResult(url, result));
    return;
  }

  if (parsed.command === 'image-info') {
    const inputPath = parsed.positionals[0];
    if (!inputPath) throw new CodeParkError('EARGS', 'image-info requires a path');
    const target = path.resolve(cwd, inputPath);
    if (!isInside(cwd, target)) throw new CodeParkError('EARGS', 'image-info path must be inside the workspace');
    const info = await readImageInfo(target);
    console.log(formatImageInfo(path.relative(cwd, target), info));
    return;
  }

  if (parsed.command === 'readiness') {
    const report = await createReadinessReport(cwd, config);
    console.log(parsed.flags.json ? formatReadinessReportJson(report) : formatReadinessReport(report));
    return;
  }

  if (parsed.command === 'notebook') {
    const notebookPath = parsed.positionals[0];
    if (!notebookPath) throw new CodeParkError('EARGS', 'notebook requires a path');
    const tools = createTools({ cwd, assumeYes, config });
    console.log(await tools.execute('read_notebook', {
      path: notebookPath,
      max_bytes: parsed.flags.maxBytes,
      max_cells: parsed.flags.maxCells,
      include_outputs: Boolean(parsed.flags.includeOutputs)
    }));
    return;
  }

  if (parsed.command === 'skill-pack') {
    const [id, outputPath] = parsed.positionals;
    if (!id || !outputPath) throw new CodeParkError('EARGS', 'skill-pack requires a skill id and output path');
    console.log(formatPackedSkill(await packLocalSkill(cwd, id, outputPath)));
    return;
  }

  if (parsed.command === 'skill-install') {
    const [packagePath, skillId] = parsed.positionals;
    if (!packagePath) throw new CodeParkError('EARGS', 'skill-install requires a package path');
    console.log(formatInstalledSkillPackage(await installSkillPackage(cwd, packagePath, { id: skillId })));
    return;
  }

  if (parsed.command === 'task-add') {
    const title = String(parsed.flags.title ?? parsed.positionals.join(' ')).trim();
    if (!title) throw new CodeParkError('EARGS', 'task-add requires a task title');
    const added = await addTask(cwd, {
      title,
      priority: parsed.flags.priority,
      dependsOn: parsed.flags.dependsOn,
      labels: parsed.flags.labels,
      notes: parsed.flags.notes
    });
    const task = await getTask(cwd, added.id);
    console.log(parsed.flags.json ? formatTaskDetailsJson(task) : formatTaskAdded(added));
    return;
  }

  if (parsed.command === 'tasks') {
    const status = parsed.positionals[0] || undefined;
    if (status && status !== 'open' && status !== 'done' && status !== 'blocked') {
      throw new CodeParkError('EARGS', 'tasks status must be open, done, or blocked');
    }
    const tasks = await listTasks(cwd, {
      status,
      priority: parsed.flags.priority,
      label: parsed.flags.label
    });
    console.log(parsed.flags.json ? formatTaskListJson(tasks) : formatTaskList(tasks));
    return;
  }

  if (parsed.command === 'task-show') {
    const id = parsed.positionals[0];
    if (!id) throw new CodeParkError('EARGS', 'task-show requires a task id');
    const task = await getTask(cwd, id);
    console.log(parsed.flags.json ? formatTaskDetailsJson(task) : formatTaskDetails(task));
    return;
  }

  if (parsed.command === 'task-update') {
    const [id, ...titleParts] = parsed.positionals;
    if (!id) throw new CodeParkError('EARGS', 'task-update requires a task id');
    const updates = {};
    if (parsed.flags.title !== undefined || titleParts.length) updates.title = parsed.flags.title ?? titleParts.join(' ');
    if (parsed.flags.priority !== undefined) updates.priority = parsed.flags.priority;
    if (parsed.flags.dependsOn !== undefined) updates.dependsOn = parsed.flags.dependsOn;
    if (parsed.flags.labels !== undefined) updates.labels = parsed.flags.labels;
    if (parsed.flags.notes !== undefined) updates.notes = parsed.flags.notes;
    const updated = await updateTask(cwd, id, updates);
    const task = await getTask(cwd, updated.id);
    console.log(parsed.flags.json ? formatTaskDetailsJson(task) : formatTaskUpdated(updated));
    return;
  }

  if (parsed.command === 'task-done') {
    const id = parsed.positionals[0];
    if (!id) throw new CodeParkError('EARGS', 'task-done requires a task id');
    const completed = await completeTask(cwd, id);
    const task = await getTask(cwd, completed.id);
    console.log(parsed.flags.json ? formatTaskDetailsJson(task) : formatTaskCompleted(completed));
    return;
  }

  if (parsed.command === 'task-open') {
    const id = parsed.positionals[0];
    if (!id) throw new CodeParkError('EARGS', 'task-open requires a task id');
    const reopened = await reopenTask(cwd, id);
    const task = await getTask(cwd, reopened.id);
    console.log(parsed.flags.json ? formatTaskDetailsJson(task) : formatTaskReopened(reopened));
    return;
  }

  if (parsed.command === 'agent-start') {
    const [taskId, ...promptParts] = parsed.positionals;
    const prompt = promptParts.join(' ').trim();
    if (!taskId || !prompt) throw new CodeParkError('EARGS', 'agent-start requires a task id and prompt');
    console.log(formatWorkerStarted(await startAgentWorker(cwd, {
      taskId,
      prompt,
      model: parsed.flags.model
    })));
    return;
  }

  if (parsed.command === 'agent-send') {
    const [id, ...messageParts] = parsed.positionals;
    const message = messageParts.join(' ').trim();
    if (!id || !message) throw new Error('agent-send requires a worker id and message');
    console.log(formatAgentMessageSent(await sendAgentMessage(cwd, id, message)));
    return;
  }

  if (parsed.command === 'app-start') {
    console.log(formatAppStart(await startApp(cwd, {
      script: parsed.positionals[0],
      id: parsed.flags.id
    })));
    return;
  }

  if (parsed.command === 'worker-start') {
    const [taskId, ...commandParts] = parsed.positionals;
    const command = buildCommandFromArgs(commandParts);
    if (!taskId || !command) throw new Error('worker-start requires a task id and command');
    console.log(formatWorkerStarted(await startWorker(cwd, { taskId, command })));
    return;
  }

  if (parsed.command === 'workers') {
    const workers = await listWorkers(cwd, { taskId: parsed.positionals[0] });
    console.log(parsed.flags.json ? formatWorkerListJson(workers) : formatWorkerList(workers));
    return;
  }

  if (parsed.command === 'dashboard') {
    const dashboard = await createAgentDashboard(cwd, { taskId: parsed.positionals[0] });
    console.log(parsed.flags.json ? formatAgentDashboardJson(dashboard) : formatAgentDashboard(dashboard));
    return;
  }

  if (parsed.command === 'dashboard-html' || parsed.command === 'dashboard-open') {
    const result = await createBrowserDashboard(cwd, config, { taskId: parsed.positionals[0] });
    if (parsed.command === 'dashboard-open') await openDashboardFile(result.absolutePath);
    console.log(formatBrowserDashboard(result));
    return;
  }

  if (parsed.command === 'code-index') {
    const query = parsed.positionals.join(' ').trim();
    if (query) {
      console.log(formatCodeSymbolResults(await findCodeSymbols(cwd, query)));
    } else {
      console.log(formatCodeIndex(await createCodeIndex(cwd)));
    }
    return;
  }

  if (parsed.command === 'worker-read') {
    const id = parsed.positionals[0];
    if (!id) throw new Error('worker-read requires a worker id');
    const worker = await readWorker(cwd, id, { tailLines: parsed.flags.tail });
    if (parsed.flags.json) {
      console.log(formatWorkerReadJson(worker, { clean: parsed.flags.clean }));
    } else {
      console.log(parsed.flags.clean ? formatWorkerReadClean(worker) : formatWorkerRead(worker));
    }
    return;
  }

  if (parsed.command === 'worker-stop') {
    const id = parsed.positionals[0];
    if (!id) throw new Error('worker-stop requires a worker id');
    console.log(formatWorkerStopped(await stopWorker(cwd, id)));
    return;
  }

  if (parsed.command === 'worker-prune') {
    const pruned = await pruneWorkers(cwd, { failedOnly: Boolean(parsed.flags.failed) });
    console.log(parsed.flags.json ? formatWorkerPrunedJson(pruned) : formatWorkerPruned(pruned));
    return;
  }

  if (parsed.command === 'setup') {
    if (config.localOnly) throw new CodeParkError('EDISABLED', 'setup is disabled in local-only mode');
    await runSetup(config);
    return;
  }

  if (parsed.command === 'onboard') {
    await runOnboardCommand(config);
    return;
  }

  if (parsed.command === 'config') {
    console.log(JSON.stringify(maskConfig(config, cwd), null, 2));
    return;
  }

  if (parsed.command === 'doctor') {
    if (config.localOnly && parsed.flags.mcpHealth) {
      throw new CodeParkError('EDISABLED', 'doctor --mcp-health is disabled in local-only mode');
    }
    const report = await runDoctor(config, { cwd, mcpHealth: Boolean(parsed.flags.mcpHealth) });
    console.log(parsed.flags.json ? formatDoctorReportJson(report) : formatDoctorReport(report));
    return;
  }

  if (parsed.command === 'ask') {
    const prompt = parsed.positionals.join(' ').trim();
    if (!prompt) throw new Error('ask requires a prompt');
    if (isBareSelfReference(prompt)) {
      const response = await createSelfStatus({ cwd, config });
      console.log(response);
      const file = await createSessionFile({ cwd });
      await writeSession({
        file,
        cwd,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: response }
        ]
      });
      return;
    }

    const rl = readline.createInterface({ input, output });
    const history = [];
    try {
      if (!(await ensureModelAuth({ config, rl }))) return;
      printModelStart(config);
      let streamed = false;
      const response = await askAgent({
        input: prompt,
        history,
        config,
        cwd,
        assumeYes,
        rl,
        stream,
        onStatus: printModelStatus,
        onToken: token => {
          streamed = true;
          output.write(token);
        }
      });
      if (streamed) output.write('\n');
      else console.log(response);
      const file = await createSessionFile({ cwd });
      await writeSession({ file, cwd, messages: history });
    } finally {
      rl.close();
    }
    return;
  }

  if (parsed.command === 'resume') {
    const session = await loadSession({ name: parsed.positionals.join(' ').trim() });
    cwd = session.cwd ? path.resolve(session.cwd) : cwd;
    await interactive({
      config,
      cwd,
      assumeYes,
      stream,
      initialHistory: session.messages,
      sessionFile: session.file,
      firstRunOnboarding: false,
      setCwd: next => { cwd = next; }
    });
    return;
  }

  await interactive({
    config,
    cwd,
    assumeYes,
    stream,
    firstRunOnboarding: shouldRunFirstRunOnboarding({
      flags: parsed.flags,
      inputIsTty: Boolean(input.isTTY),
      configExists: configFileExists()
    }),
    setCwd: next => { cwd = next; }
  });
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let command = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      command = '--help';
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      command = '--version';
      continue;
    }
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (!arg.startsWith('-')) {
      if (!command) command = arg;
      else positionals.push(arg);
      continue;
    }

    if (arg === '--yes') {
      flags.yes = true;
      continue;
    }
    if (arg === '--mcp-health') {
      flags.mcpHealth = true;
      continue;
    }
    if (arg === '--local-only') {
      flags.localOnly = true;
      continue;
    }
    if (arg === '--secure') {
      flags.secureMode = true;
      continue;
    }
    if (arg === '--no-stream') {
      flags.stream = false;
      continue;
    }
    if (arg === '--no-start') {
      flags.noStart = true;
      continue;
    }
    if (arg === '--no-open') {
      flags.noOpen = true;
      continue;
    }
    if (arg === '--clean') {
      flags.clean = true;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--failed') {
      flags.failed = true;
      continue;
    }
    if (arg === '--follow-redirects') {
      flags.followRedirects = true;
      continue;
    }
    if (arg === '--include-outputs') {
      flags.includeOutputs = true;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '--detached' || arg === '--detach') {
      flags.detached = true;
      continue;
    }
    if (arg === '--interactive') {
      flags.interactive = true;
      continue;
    }

    const next = argv[i + 1];
    if (!next) throw new CodeParkError('EFLAGS', `${arg} requires a value`);
    i += 1;
    if (arg === '--cwd') flags.cwd = next;
    else if (arg === '--provider') flags.provider = next;
    else if (arg === '--model') flags.model = next;
    else if (arg === '--base-url') flags.baseUrl = next;
    else if (arg === '--tail') flags.tail = next;
    else if (arg === '--priority') flags.priority = next;
    else if (arg === '--depends-on') appendFlag(flags, 'dependsOn', next);
    else if (arg === '--label') {
      appendFlag(flags, 'labels', next);
      flags.label = next;
    }
    else if (arg === '--notes' || arg === '--note') flags.notes = next;
    else if (arg === '--title') flags.title = next;
    else if (arg === '--id') flags.id = next;
    else if (arg === '--target') flags.target = next;
    else if (arg === '--bin-dir') flags.binDir = next;
    else if (arg === '--method') flags.method = next;
    else if (arg === '--header') appendFlag(flags, 'headers', next);
    else if (arg === '--timeout-ms') flags.timeoutMs = next;
    else if (arg === '--max-bytes') flags.maxBytes = next;
    else if (arg === '--max-cells') flags.maxCells = next;
    else if (arg === '--mode') flags.mode = next;
    else throw new CodeParkError('EFLAGS', `unknown flag: ${arg}`);
  }

  return { command, flags, positionals };
}

function appendFlag(flags, key, value) {
  if (!flags[key]) flags[key] = [];
  flags[key].push(value);
}

function buildCommandFromArgs(parts) {
  const commandParts = parts.filter(part => String(part).trim());
  if (commandParts.length === 0) return '';
  if (commandParts.length === 1) return String(commandParts[0]).trim();
  return quote(commandParts);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function parseHeaderFlags(values) {
  const entries = Array.isArray(values) ? values : (values ? [values] : []);
  const headers = {};
  for (const raw of entries) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const separator = text.includes(':') ? ':' : (text.includes('=') ? '=' : '');
    if (!separator) continue;
    const index = text.indexOf(separator);
    const key = text.slice(0, index).trim();
    const value = text.slice(index + 1).trim();
    if (!key) continue;
    headers[key] = value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function sortObjectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

function formatWebFetchResult(url, result) {
  const headerLines = Object.entries(result.headers || {})
    .slice(0, 30)
    .map(([key, value]) => `- ${key}: ${value}`);
  return [
    `Fetched ${url}`,
    '',
    `Status: ${result.status}`,
    '',
    'Headers:',
    ...(headerLines.length ? headerLines : ['- (none)']),
    '',
    'Body:',
    result.bodyText || '',
    ...(result.truncated ? ['', '[truncated]'] : [])
  ].join('\n');
}

function formatWebFetchJson(url, result) {
  return `${JSON.stringify({
    url,
    status: result.status,
    headers: sortObjectKeys(result.headers || {}),
    bodyText: result.bodyText || '',
    truncated: Boolean(result.truncated)
  }, null, 2)}\n`;
}

function formatImageInfo(relativePath, info) {
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

async function interactive({ config, cwd, assumeYes, stream, setCwd, initialHistory = [], sessionFile = null, firstRunOnboarding = false }) {
  const scriptedLines = input.isTTY ? null : splitScriptedInput(await readStdinText());
  const rl = readline.createInterface({ input, output, prompt: 'codepark> ' });
  if (input.isTTY) input.resume();
  const promptIfTty = () => {
    if (input.isTTY) rl.prompt();
  };
  const history = [...initialHistory];
  let currentCwd = cwd;
  let currentSessionFile = sessionFile ?? await createSessionFile({ cwd: currentCwd });
  const updateCwd = next => {
    currentCwd = next;
    setCwd(next);
  };
  const persistSession = async () => {
    currentSessionFile = await writeSession({
      file: currentSessionFile,
      cwd: currentCwd,
      messages: history
    });
  };

  if (firstRunOnboarding) {
    await runOnboarding(config, { rl });
  }

  console.log('CodePark interactive mode. Type /help for commands, /exit to quit.');
  console.log(`Workspace: ${currentCwd}`);
  console.log(`Provider: ${config.provider || 'custom'} (${config.baseUrl})`);
  console.log(`Session: ${path.basename(currentSessionFile)}`);
  if (history.length) console.log(`Resumed ${history.filter(message => message.role !== 'system').length} message(s).`);
  printModelAuthHint(config);
  promptIfTty();

  try {
    for await (const rawLine of scriptedLines ?? rl) {
      const line = rawLine.trim();
      try {
        if (!line) {
          promptIfTty();
          continue;
        }

        if (line.startsWith('/')) {
          const shouldExit = await handleSlashCommand({
            line,
            config,
            getCwd: () => currentCwd,
            setCwd: updateCwd,
            history,
            getSessionFile: () => currentSessionFile,
            setSessionFile: next => { currentSessionFile = next; },
            persistSession,
            rl,
            assumeYes
          });
          if (shouldExit) break;
          promptIfTty();
          continue;
        }

        if (isBareSelfReference(line)) {
          const response = await createSelfStatus({ cwd: currentCwd, config });
          console.log(response);
          history.push({ role: 'user', content: line });
          history.push({ role: 'assistant', content: response });
          await maybeAutoCompactHistory({ history, config });
          await persistSession();
          promptIfTty();
          continue;
        }

        let streamed = false;
        await maybeAutoCompactHistory({ history, config, persistSession });
        if (!(await ensureModelAuth({ config, rl }))) {
          promptIfTty();
          continue;
        }
        printModelStart(config);
        const response = await askAgent({
          input: line,
          history,
          config,
          cwd: currentCwd,
          assumeYes,
          rl,
          stream,
          onStatus: printModelStatus,
          onToken: token => {
            streamed = true;
            output.write(token);
          }
        });
        if (streamed) output.write('\n');
        else console.log(response);
        await maybeAutoCompactHistory({ history, config });
        await persistSession();
      } catch (error) {
        const wantsJson = line.includes('--json') || line.endsWith(' json');
        if (wantsJson) {
          console.log(formatJsonError(error));
        } else {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
        }
      }
      promptIfTty();
    }
  } finally {
    stopAllShellSessions();
    rl.close();
  }
}

async function handleSlashCommand({
  line,
  config,
  getCwd,
  setCwd,
  history,
  getSessionFile,
  setSessionFile,
  persistSession,
  rl,
  assumeYes
}) {
  const [command, ...rest] = splitCommand(line);
  const arg = rest.join(' ').trim();
  const tools = createTools({ cwd: getCwd(), assumeYes, rl, config });

  if (command === '/exit' || command === '/quit') return true;
  if (command === '/help') {
    console.log(helpText);
    return false;
  }
  if (command === '/clear') {
    history.length = 0;
    await persistSession();
    console.log('Chat history cleared.');
    return false;
  }
  if (command === '/config') {
    console.log(JSON.stringify(maskConfig(config, getCwd()), null, 2));
    return false;
  }
  if (command === '/providers') {
    printProviders();
    return false;
  }
  if (command === '/provider') {
    if (!arg) throw new CodeParkError('EARGS', '/provider requires a provider name');
    if (config.localOnly) throw new CodeParkError('EDISABLED', '/provider is disabled in local-only mode');
    Object.assign(config, await saveProviderProfile(arg));
    console.log(`Provider set to ${config.provider}`);
    return false;
  }
  if (command === '/setup') {
    if (config.localOnly) throw new CodeParkError('EDISABLED', '/setup is disabled in local-only mode');
    await runSetup(config, { rl });
    return false;
  }
  if (command === '/key') {
    await runKeySetup(config, { rl });
    return false;
  }
  if (command === '/model') {
    if (!arg) throw new CodeParkError('EARGS', '/model requires a model name');
    config.model = arg;
    await saveConfig({ model: arg });
    console.log(`Model set to ${arg}`);
    return false;
  }
  if (command === '/base-url') {
    if (!arg) throw new CodeParkError('EARGS', '/base-url requires a URL');
    if (config.localOnly) throw new CodeParkError('EDISABLED', '/base-url is disabled in local-only mode');
    config.baseUrl = arg;
    await saveConfig({ baseUrl: arg });
    console.log(`Base URL set to ${arg}`);
    return false;
  }
  if (command === '/cwd') {
    if (!arg) throw new CodeParkError('EARGS', '/cwd requires a path');
    const next = path.resolve(getCwd(), arg);
    const stat = await fs.stat(next).catch(error => {
      if (error?.code === 'ENOENT') throw new Error(`path does not exist: ${arg}`);
      throw error;
    });
    if (!stat.isDirectory()) throw new Error(`not a directory: ${arg}`);
    setCwd(next);
    console.log(`Workspace: ${next}`);
    return false;
  }
  if (command === '/project') {
    console.log(await projectOverview(getCwd()));
    return false;
  }
  if (command === '/scripts') {
    console.log(await projectOverview(getCwd(), { scriptsOnly: true }));
    return false;
  }
  if (command === '/workspace-plan') {
    const parsed = parseSlashArgs('workspace-plan', arg);
    console.log(await tools.execute('workspace_plan', { json: Boolean(parsed.flags.json) }));
    return false;
  }
  if (command === '/workspace-boot') {
    const parsed = parseSlashArgs('workspace-boot', arg);
    const boot = await bootWorkspace(getCwd(), config, {
      start: !parsed.flags.noStart,
      id: parsed.flags.id
    });
    if (!parsed.flags.noOpen && boot.dashboard?.absolutePath) await openDashboardFile(boot.dashboard.absolutePath);
    console.log(parsed.flags.json ? formatWorkspaceBootJson(boot) : formatWorkspaceBoot(boot));
    return false;
  }
  if (command === '/assess' || command === '/assessment' || command === '/audit') {
    const parsed = parseSlashArgs('assess', arg);
    console.log(await tools.execute('project_assessment', { json: Boolean(parsed.flags.json) }));
    return false;
  }
  if (command === '/assess-tasks' || command === '/assessment-tasks' || command === '/audit-tasks') {
    const parsed = parseSlashArgs('assess-tasks', arg);
    console.log(await tools.execute('create_assessment_tasks', {
      json: Boolean(parsed.flags.json),
      force: Boolean(parsed.flags.force)
    }));
    return false;
  }
  if (command === '/profile') {
    console.log(await tools.execute('read_profile', {}));
    return false;
  }
  if (command === '/profile-init') {
    const parsed = parseSlashArgs('profile-init', arg);
    console.log(await tools.execute('init_profile', { force: Boolean(parsed.flags.force) }));
    return false;
  }
  if (command === '/policy') {
    const parsed = parseSlashArgs('policy', arg);
    console.log(await tools.execute('read_policy', { json: parsed.flags.json }));
    return false;
  }
  if (command === '/policy-check') {
    const parsed = parseSlashArgs('policy-check', arg);
    const type = parsed.positionals[0];
    const value = parsed.positionals.slice(1).join(' ').trim();
    if (!type || !value) throw new CodeParkError('EARGS', '/policy-check requires write|command and a value');
    console.log(await tools.execute('check_policy', { type, value, json: parsed.flags.json }));
    return false;
  }
  if (command === '/policy-presets') {
    console.log(`Workspace policy presets\n${listWorkspacePolicyPresets().map(name => `- ${name}`).join('\n')}`);
    return false;
  }
  if (command === '/policy-preset') {
    const parsed = parseSlashArgs('policy-preset', arg);
    const preset = parsed.positionals[0];
    if (!preset) throw new CodeParkError('EARGS', '/policy-preset requires a preset name');
    console.log(await tools.execute('apply_policy_preset', {
      preset,
      force: Boolean(parsed.flags.force)
    }));
    return false;
  }
  if (command === '/container-runtime') {
    console.log(formatContainerRuntime(await detectContainerRuntime(getCwd())));
    return false;
  }
  if (command === '/compose-start') {
    const parsed = parseSlashArgs('compose-start', arg);
    console.log(await tools.execute('compose_start', {
      detached: Boolean(parsed.flags.detached),
      id: parsed.flags.id
    }));
    return false;
  }
  if (command === '/compose-stop') {
    console.log(await tools.execute('compose_stop', {}));
    return false;
  }
  if (command === '/find') {
    const tokens = parseShell(arg ?? '').map(token => {
      if (typeof token === 'string') return token;
      throw new CodeParkError('ESHELL', '/find does not support shell operators');
    });
    const [pattern, searchPath, ...rest] = tokens;
    if (!pattern) throw new CodeParkError('EARGS', '/find requires a glob pattern');
    if (rest.length) throw new CodeParkError('EARGS', '/find expects: /find <glob> [path]');
    console.log(await tools.execute('find_files', { pattern, path: searchPath || '.', max_results: 200 }));
    return false;
  }
  if (command === '/grep') {
    const tokens = parseShell(arg ?? '').map(token => {
      if (typeof token === 'string') return token;
      throw new CodeParkError('ESHELL', '/grep does not support shell operators');
    });
    const [pattern, searchPath, ...rest] = tokens;
    if (!pattern) throw new CodeParkError('EARGS', '/grep requires text to search for');
    if (rest.length) throw new CodeParkError('EARGS', '/grep expects: /grep <text> [path]');
    console.log(await tools.execute('search_text', { pattern, path: searchPath || '.', max_matches: 200 }));
    return false;
  }
  if (command === '/web') {
    if (config.localOnly) throw new CodeParkError('EDISABLED', '/web is disabled in local-only mode');
    const parsed = parseSlashArgs('web', arg);
    const url = parsed.positionals[0];
    if (!url) throw new CodeParkError('EARGS', '/web requires a URL');
    const headers = parseHeaderFlags(parsed.flags.headers);
    console.log(await tools.execute('web_fetch', {
      url,
      method: parsed.flags.method,
      headers,
      timeout_ms: parsed.flags.timeoutMs,
      max_bytes: parsed.flags.maxBytes,
      follow_redirects: Boolean(parsed.flags.followRedirects),
      json: parsed.flags.json
    }));
    return false;
  }
  if (command === '/image-info') {
    const parsed = parseSlashArgs('image-info', arg);
    const inputPath = parsed.positionals[0];
    if (!inputPath) throw new CodeParkError('EARGS', '/image-info requires a path');
    console.log(await tools.execute('image_info', { path: inputPath }));
    return false;
  }
  if (command === '/readiness') {
    const parsed = parseSlashArgs('readiness', arg);
    const report = await createReadinessReport(getCwd(), config);
    console.log(parsed.flags.json ? formatReadinessReportJson(report) : formatReadinessReport(report));
    return false;
  }
  if (command === '/notebook') {
    const parsed = parseSlashArgs('notebook', arg);
    const notebookPath = parsed.positionals[0];
    if (!notebookPath) throw new CodeParkError('EARGS', '/notebook requires a path');
    console.log(await tools.execute('read_notebook', {
      path: notebookPath,
      max_bytes: parsed.flags.maxBytes,
      max_cells: parsed.flags.maxCells,
      include_outputs: Boolean(parsed.flags.includeOutputs)
    }));
    return false;
  }
  if (command === '/code-index') {
    if (arg) console.log(await tools.execute('find_code_symbols', { query: arg, max_results: 100 }));
    else console.log(await tools.execute('code_index', { max_files: 250, max_symbols: 100 }));
    return false;
  }
  if (command === '/run') {
    if (!arg) throw new CodeParkError('EARGS', '/run requires a package script name');
    console.log(await tools.execute('run_package_script', { script: arg, timeout_ms: 300000 }));
    return false;
  }
  if (command === '/quality-gate') {
    console.log(await tools.execute('quality_gate', { timeout_ms: 300000 }));
    return false;
  }
  if (command === '/harness-init' || command === '/hook-init') {
    const parsed = parseSlashArgs(command.slice(1), arg);
    console.log(await tools.execute('init_harness', { force: Boolean(parsed.flags.force) }));
    return false;
  }
  if (command === '/launcher-install') {
    const parsed = parseSlashArgs('launcher-install', arg);
    console.log(await tools.execute('install_launcher', {
      target: parsed.flags.target,
      force: Boolean(parsed.flags.force)
    }));
    return false;
  }
  if (command === '/ls') {
    console.log(await tools.execute('list_files', { path: arg || '.', max_depth: 2 }));
    return false;
  }
  if (command === '/read') {
    if (!arg) throw new CodeParkError('EARGS', '/read requires a path');
    console.log(await tools.execute('read_file', { path: arg, max_bytes: 30000 }));
    return false;
  }
  if (command === '/patch') {
    if (!arg) throw new CodeParkError('EARGS', '/patch requires a patch file path');
    const patchFile = path.resolve(getCwd(), arg);
    if (!isInside(getCwd(), patchFile)) throw new Error(`path escapes workspace: ${arg}`);
    const patch = await fs.readFile(patchFile, 'utf8');
    console.log(await tools.execute('apply_patch', { patch }));
    return false;
  }
  if (command === '/shell') {
    if (!arg) throw new CodeParkError('EARGS', '/shell requires a command');
    console.log(await tools.execute('run_shell', { command: arg, timeout_ms: 60000 }));
    return false;
  }
  if (command === '/shell-start') {
    console.log(await tools.execute('start_shell_session', { id: arg || undefined }));
    return false;
  }
  if (command === '/shell-send') {
    const [id, shellCommand] = splitFirstArg(arg);
    if (!id || !shellCommand) throw new CodeParkError('EARGS', '/shell-send requires a session id and command');
    console.log(await tools.execute('send_shell_session', {
      id,
      command: shellCommand,
      timeout_ms: 30000
    }));
    return false;
  }
  if (command === '/shell-read') {
    if (!arg) throw new CodeParkError('EARGS', '/shell-read requires a session id');
    console.log(await tools.execute('read_shell_session', { id: arg }));
    return false;
  }
  if (command === '/shells') {
    console.log(await tools.execute('list_shell_sessions', {}));
    return false;
  }
  if (command === '/shell-stop') {
    if (!arg) throw new CodeParkError('EARGS', '/shell-stop requires a session id');
    console.log(await tools.execute('stop_shell_session', { id: arg }));
    return false;
  }
  if (command === '/git') {
    console.log(formatGitSummary(await gitSummary(getCwd())));
    return false;
  }
  if (command === '/diff') {
    console.log(arg ? await gitDiff(getCwd(), arg) : await gitDiff(getCwd()));
    return false;
  }
  if (command === '/checkpoint') {
    console.log(await tools.execute('create_checkpoint', { name: arg || 'checkpoint' }));
    return false;
  }
  if (command === '/checkpoints') {
    console.log(await tools.execute('list_checkpoints', {}));
    return false;
  }
  if (command === '/restore-checkpoint') {
    if (!arg) throw new CodeParkError('EARGS', '/restore-checkpoint requires a checkpoint id, prefix, or name');
    console.log(await tools.execute('restore_checkpoint', { id: arg }));
    return false;
  }
  if (command === '/task-add') {
    const parsed = parseSlashArgs('task-add', arg);
    const title = String(parsed.flags.title ?? parsed.positionals.join(' ')).trim();
    if (!title) throw new CodeParkError('EARGS', '/task-add requires a task title');
    console.log(await tools.execute('add_task', {
      title,
      priority: parsed.flags.priority,
      depends_on: parsed.flags.dependsOn,
      labels: parsed.flags.labels,
      notes: parsed.flags.notes,
      json: parsed.flags.json
    }));
    return false;
  }
  if (command === '/tasks') {
    const parsed = parseSlashArgs('tasks', arg);
    const status = parsed.positionals[0] || undefined;
    if (status && status !== 'open' && status !== 'done' && status !== 'blocked') {
      throw new CodeParkError('EARGS', '/tasks status must be open, done, or blocked');
    }
    console.log(await tools.execute('list_tasks', {
      status,
      priority: parsed.flags.priority,
      label: parsed.flags.label,
      json: parsed.flags.json
    }));
    return false;
  }
  if (command === '/task-show') {
    const parsed = parseSlashArgs('task-show', arg);
    const id = parsed.positionals[0];
    if (!id) throw new CodeParkError('EARGS', '/task-show requires a task id or unique prefix');
    console.log(await tools.execute('show_task', { id, json: parsed.flags.json }));
    return false;
  }
  if (command === '/task-update') {
    const parsed = parseSlashArgs('task-update', arg);
    const [id, ...titleParts] = parsed.positionals;
    if (!id) throw new CodeParkError('EARGS', '/task-update requires a task id or unique prefix');
    const updates = { id };
    if (parsed.flags.title !== undefined || titleParts.length) updates.title = parsed.flags.title ?? titleParts.join(' ');
    if (parsed.flags.priority !== undefined) updates.priority = parsed.flags.priority;
    if (parsed.flags.dependsOn !== undefined) updates.depends_on = parsed.flags.dependsOn;
    if (parsed.flags.labels !== undefined) updates.labels = parsed.flags.labels;
    if (parsed.flags.notes !== undefined) updates.notes = parsed.flags.notes;
    updates.json = parsed.flags.json;
    console.log(await tools.execute('update_task', updates));
    return false;
  }
  if (command === '/task-done') {
    const parsed = parseSlashArgs('task-done', arg);
    const id = parsed.positionals[0];
    if (!id) throw new CodeParkError('EARGS', '/task-done requires a task id or unique prefix');
    console.log(await tools.execute('complete_task', { id, json: parsed.flags.json }));
    return false;
  }
  if (command === '/task-open') {
    const parsed = parseSlashArgs('task-open', arg);
    const id = parsed.positionals[0];
    if (!id) throw new CodeParkError('EARGS', '/task-open requires a task id or unique prefix');
    console.log(await tools.execute('reopen_task', { id, json: parsed.flags.json }));
    return false;
  }
  if (command === '/agent-start') {
    const [taskId, prompt] = splitFirstArg(arg);
    if (!taskId || !prompt) throw new CodeParkError('EARGS', '/agent-start requires a task id and prompt');
    console.log(await tools.execute('start_agent_worker', {
      task_id: taskId,
      prompt
    }));
    return false;
  }
  if (command === '/agent-send') {
    const [id, message] = splitFirstArg(arg);
    if (!id || !message) throw new CodeParkError('EARGS', '/agent-send requires a worker id and message');
    console.log(await tools.execute('send_agent_message', {
      id,
      message
    }));
    return false;
  }
  if (command === '/app-start') {
    const parsed = parseSlashArgs('app-start', arg);
    console.log(await tools.execute('start_app', {
      script: parsed.positionals[0],
      id: parsed.flags.id
    }));
    return false;
  }
  if (command === '/worker-start') {
    const [taskId, workerCommand] = splitFirstArg(arg);
    if (!taskId || !workerCommand) throw new CodeParkError('EARGS', '/worker-start requires a task id and command');
    console.log(await tools.execute('start_worker', {
      task_id: taskId,
      command: workerCommand
    }));
    return false;
  }
  if (command === '/workers') {
    const [taskId, json] = parseWorkersArg(arg);
    console.log(await tools.execute('list_workers', { task_id: taskId || undefined, json }));
    return false;
  }
  if (command === '/dashboard') {
    const [taskId, json] = parseDashboardArg(arg);
    console.log(await tools.execute('agent_dashboard', { task_id: taskId || undefined, json }));
    return false;
  }
  if (command === '/dashboard-html') {
    const [taskId] = parseDashboardArg(arg);
    console.log(await tools.execute('agent_dashboard_html', { task_id: taskId || undefined }));
    return false;
  }
  if (command === '/worker-read') {
    const { id, clean, tailLines, json } = parseWorkerReadArg(arg);
    if (!id) throw new CodeParkError('EARGS', '/worker-read requires a worker id or unique prefix');
    console.log(await tools.execute('read_worker', { id, clean, json, tail_lines: tailLines }));
    return false;
  }
  if (command === '/worker-stop') {
    if (!arg) throw new CodeParkError('EARGS', '/worker-stop requires a worker id or unique prefix');
    console.log(await tools.execute('stop_worker', { id: arg }));
    return false;
  }
  if (command === '/worker-prune') {
    const { failedOnly, json } = parseWorkerPruneArg(arg);
    console.log(await tools.execute('prune_workers', { failed_only: failedOnly, json }));
    return false;
  }
  if (command === '/hooks') {
    console.log(await tools.execute('list_hooks', {}));
    return false;
  }
  if (command === '/hook') {
    if (!arg) throw new CodeParkError('EARGS', '/hook requires a hook name or unique prefix');
    console.log(await tools.execute('run_hook', { name: arg, timeout_ms: 300000 }));
    return false;
  }
  if (command === '/skills') {
    console.log(await tools.execute('list_skills', { query: arg }));
    return false;
  }
  if (command === '/skill') {
    if (!arg) throw new CodeParkError('EARGS', '/skill requires a skill id or unique prefix');
    console.log(await tools.execute('read_skill', { id: arg }));
    return false;
  }
  if (command === '/skill-pack') {
    const [id, outputPath] = splitFirstArg(arg);
    if (!id || !outputPath) throw new CodeParkError('EARGS', '/skill-pack requires a skill id and output path');
    console.log(await tools.execute('pack_skill', {
      id,
      output_path: outputPath
    }));
    return false;
  }
  if (command === '/skill-install') {
    const [packagePath, skillId] = splitFirstArg(arg);
    if (!packagePath) throw new CodeParkError('EARGS', '/skill-install requires a package path');
    console.log(await tools.execute('install_skill_package', {
      package_path: packagePath,
      skill_id: skillId || undefined
    }));
    return false;
  }
  if (command === '/save') {
    const file = await saveSession({ cwd: getCwd(), messages: history });
    console.log(`Saved ${file}`);
    return false;
  }
  if (command === '/resume') {
    const session = await loadSession({ name: arg });
    history.length = 0;
    history.push(...session.messages);
    if (session.cwd) {
      const stat = await fs.stat(session.cwd).catch(() => null);
      if (stat?.isDirectory()) setCwd(session.cwd);
    }
    setSessionFile(session.file);
    console.log(`Resumed ${path.basename(session.file)} (${history.filter(message => message.role !== 'system').length} message(s)).`);
    return false;
  }
  if (command === '/sessions') {
    const sessions = await loadSessionList();
    const current = path.basename(getSessionFile());
    console.log(sessions.length ? sessions.map(name => name === current ? `${name} *` : name).join('\n') : `No sessions in ${defaultSessionDir}`);
    return false;
  }
  if (command === '/tokens') {
    console.log(formatTokenBudget({
      messages: history,
      limit: config.contextLimitTokens,
      threshold: config.compactThresholdTokens
    }));
    return false;
  }
  if (command === '/compact') {
    const keepMessages = arg ? Number(arg) : undefined;
    if (arg && (!Number.isFinite(keepMessages) || keepMessages < 1)) {
      throw new CodeParkError('EARGS', '/compact keep value must be a positive number');
    }
    const result = compactHistory({ messages: history, keepMessages });
    if (result.compacted) {
      replaceHistory(history, result.messages);
      await persistSession();
      console.log(`Compacted history: ${result.beforeTokens} -> ${result.afterTokens} estimated tokens.`);
    } else {
      console.log(`No compaction needed: ${result.beforeTokens} estimated tokens.`);
    }
    return false;
  }
  if (command === '/mcp') {
    if (config.localOnly) throw new CodeParkError('EDISABLED', '/mcp is disabled in local-only mode');
    console.log(formatWorkspaceMcpTools(await listWorkspaceMcpTools(getCwd())));
    return false;
  }
  if (command === '/mcp-call') {
    if (config.localOnly) throw new CodeParkError('EDISABLED', '/mcp-call is disabled in local-only mode');
    const [serverName, restArgs] = splitFirstArg(arg);
    const [toolName, jsonArgs] = splitFirstArg(restArgs);
    if (!serverName || !toolName) throw new CodeParkError('EARGS', '/mcp-call requires a server and tool name');
    const result = await callWorkspaceMcpTool({
      cwd: getCwd(),
      serverName,
      toolName,
      args: parseJsonObject(jsonArgs || '{}')
    });
    console.log(formatMcpToolCallResult(result));
    return false;
  }
  if (command === '/doctor') {
    const { json, mcpHealth } = parseDoctorArg(arg);
    if (config.localOnly && mcpHealth) {
      throw new CodeParkError('EDISABLED', '/doctor --mcp-health is disabled in local-only mode');
    }
    const report = await runDoctor(config, { cwd: getCwd(), mcpHealth });
    console.log(json ? formatDoctorReportJson(report) : formatDoctorReport(report));
    return false;
  }

  throw new Error(`unknown command: ${command}`);
}

async function maybeAutoCompactHistory({ history, config, persistSession }) {
  const result = compactHistoryIfNeeded({
    messages: history,
    maxTokens: config.compactThresholdTokens
  });
  if (!result.compacted) return false;
  replaceHistory(history, result.messages);
  if (persistSession) await persistSession();
  console.log(`Auto-compacted history: ${result.beforeTokens} -> ${result.afterTokens} estimated tokens.`);
  return true;
}

function replaceHistory(history, messages) {
  history.length = 0;
  history.push(...messages);
}

function splitCommand(line) {
  const trimmed = line.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return [trimmed];
  return [trimmed.slice(0, firstSpace), trimmed.slice(firstSpace + 1)];
}

function splitScriptedInput(value) {
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

async function readStdinText() {
  input.setEncoding('utf8');
  let text = '';
  for await (const chunk of input) {
    text += chunk;
  }
  return text;
}

function splitFirstArg(value) {
  const trimmed = value.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return [trimmed, ''];
  return [trimmed.slice(0, firstSpace), trimmed.slice(firstSpace + 1).trim()];
}

function parseWorkerReadArg(value) {
  const tokens = parseShell(value ?? '').map(token => {
    if (typeof token === 'string') return token;
    throw new CodeParkError('ESHELL', '/worker-read does not support shell operators');
  });
  let clean = false;
  let json = false;
  let tailLines;
  const positional = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--clean') {
      clean = true;
    } else if (token === '--json') {
      json = true;
    } else if (token === '--tail') {
      tailLines = tokens[index + 1];
      if (!tailLines) throw new CodeParkError('EARGS', '/worker-read --tail requires a value');
      index += 1;
    } else if (token.startsWith('-')) {
      throw new CodeParkError('EFLAGS', `unknown /worker-read flag: ${token}`);
    } else {
      positional.push(token);
    }
  }
  return { id: positional[0] ?? '', clean, tailLines, json };
}

function parseWorkersArg(value) {
  const tokens = parseShell(value ?? '').map(token => {
    if (typeof token === 'string') return token;
    throw new CodeParkError('ESHELL', '/workers does not support shell operators');
  });
  let json = false;
  const positional = [];
  for (const token of tokens) {
    if (token === '--json') json = true;
    else if (token.startsWith('-')) throw new CodeParkError('EFLAGS', `unknown /workers flag: ${token}`);
    else positional.push(token);
  }
  return [positional[0] ?? '', json];
}

function parseWorkerPruneArg(value) {
  const tokens = parseShell(value ?? '').map(token => {
    if (typeof token === 'string') return token;
    throw new CodeParkError('ESHELL', '/worker-prune does not support shell operators');
  });
  let failedOnly = false;
  let json = false;
  for (const token of tokens) {
    if (token === '--failed') failedOnly = true;
    else if (token === '--json') json = true;
    else throw new CodeParkError('EFLAGS', `unknown /worker-prune flag: ${token}`);
  }
  return { failedOnly, json };
}

function parseDashboardArg(value) {
  const tokens = parseShell(value ?? '').map(token => {
    if (typeof token === 'string') return token;
    throw new CodeParkError('ESHELL', '/dashboard does not support shell operators');
  });
  let json = false;
  const positional = [];
  for (const token of tokens) {
    if (token === '--json') json = true;
    else if (token.startsWith('-')) throw new CodeParkError('EFLAGS', `unknown /dashboard flag: ${token}`);
    else positional.push(token);
  }
  return [positional[0] ?? '', json];
}

function parseDoctorArg(value) {
  const tokens = parseShell(value ?? '').map(token => {
    if (typeof token === 'string') return token;
    throw new CodeParkError('ESHELL', '/doctor does not support shell operators');
  });
  let json = false;
  let mcpHealth = false;
  for (const token of tokens) {
    if (token === '--json') json = true;
    else if (token === '--mcp-health') mcpHealth = true;
    else throw new CodeParkError('EFLAGS', `unknown /doctor flag: ${token}`);
  }
  return { json, mcpHealth };
}

function parseSlashArgs(command, value) {
  const tokens = parseShell(value ?? '').map(token => {
    if (typeof token === 'string') return token;
    throw new CodeParkError('ESHELL', `/${command} does not support shell operators`);
  });
  return parseArgs([command, ...tokens]);
}

function parseJsonObject(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new CodeParkError('EJSON', 'invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CodeParkError('EJSON', 'expected a JSON object');
  }
  return parsed;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function writeInitialExamples(cwd) {
  const files = [
    {
      path: '.codepark.example.env',
      content: [
        '# Copy values into your shell profile or a local .env loader if you use one.',
        'CODEPARK_BASE_URL=https://api.openai.com/v1',
        'CODEPARK_MODEL=gpt-4o-mini',
        'CODEPARK_API_KEY=',
        ''
      ].join('\n')
    },
    {
      path: '.codepark/hooks.example.json',
      content: `${JSON.stringify({
        hooks: {
          verify: ['npm run verify']
        }
      }, null, 2)}\n`
    },
    {
      path: '.codepark/skills/example-review.md',
      content: [
        '# Example Review',
        '',
        'Use this local skill to capture project-owned review rules.',
        '',
        '- Check correctness before polish.',
        '- Prefer small, reversible changes.',
        '- Run the project verification command before closing work.',
        ''
      ].join('\n')
    }
  ];

  for (const file of files) {
    const target = path.join(cwd, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    let wrote = true;
    await fs.writeFile(target, file.content, { flag: 'wx' }).catch(error => {
      if (error?.code === 'EEXIST') {
        wrote = false;
        return;
      }
      throw error;
    });
    console.log(wrote ? `Wrote ${target}` : `Skipped ${target}`);
  }
}

async function launchVisibleTerminal({ cwd, flags }) {
  if (process.platform !== 'darwin') {
    throw new Error('codepark launch currently opens Terminal on macOS only; run `codepark` directly on this platform.');
  }

  const command = buildVisibleTerminalLaunchCommand(cwd, flags);
  await execFileAsync('osascript', [
    '-e',
    `tell application "Terminal" to do script ${appleScriptString(command)}`,
    '-e',
    'tell application "Terminal" to activate'
  ]);
  console.log('Opened CodePark in Terminal.');
}

export function buildVisibleTerminalLaunchCommand(cwd, flags = {}) {
  const launchArgs = flags.interactive
    ? ['--cwd', cwd]
    : ['--secure', '--cwd', cwd, 'workspace-boot'];
  if (flags.interactive) {
    if (flags.secureMode) launchArgs.push('--secure');
    if (flags.localOnly) launchArgs.push('--local-only');
  } else {
    if (flags.noStart) launchArgs.push('--no-start');
    if (flags.noOpen) launchArgs.push('--no-open');
    if (flags.id) launchArgs.push('--id', flags.id);
  }
  if (flags.provider) launchArgs.push('--provider', flags.provider);
  if (flags.model) launchArgs.push('--model', flags.model);
  if (flags.baseUrl) launchArgs.push('--base-url', flags.baseUrl);
  return buildCodeParkShellCommand(cwd, launchArgs);
}

async function openDashboardFile(file) {
  if (process.platform === 'darwin') {
    await execFileAsync('open', [file]);
    return;
  }
  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', file]);
    return;
  }
  await execFileAsync('xdg-open', [file]);
}

function printProviders() {
  for (const profile of listProviderProfiles()) {
    const keyText = profile.requiresApiKey ? `env ${profile.apiKeyEnv}` : 'no API key required';
    console.log(`${profile.name}: ${profile.baseUrl} (${profile.defaultModel}, ${keyText})`);
  }
}

async function saveProviderProfile(name) {
  const next = loadConfig({ provider: name });
  await saveConfig({
    provider: next.provider,
    baseUrl: next.baseUrl,
    model: next.model
  });
  return loadConfig({});
}

async function runOnboardCommand(config) {
  if (!input.isTTY) {
    const scripted = splitScriptedInput(await readStdinText());
    await runOnboarding(config, { rl: createScriptedPrompt(scripted) });
    return;
  }
  const rl = readline.createInterface({ input, output });
  try {
    await runOnboarding(config, { rl });
  } finally {
    rl.close();
  }
}

function createScriptedPrompt(lines) {
  return {
    async question(prompt) {
      output.write(prompt);
      return lines.shift() ?? '';
    }
  };
}

async function runSetup(config, options = {}) {
  const rl = options.rl ?? readline.createInterface({ input, output });
  const ownsReadline = !options.rl;
  let profile;
  let baseUrl;
  let model;
  let shouldSetKey;

  try {
    console.log(`Secure setup stores config in ~/.codepark/config.json with 0600 permissions${config.secretStore === 'keychain' ? ' and API keys in macOS Keychain' : ''}.`);
    console.log('The API key prompt does not echo input.');

    const provider = await promptWithDefault(rl, 'Provider', config.provider || 'openai');
    profile = resolveProviderProfile(provider);
    baseUrl = await promptWithDefault(rl, 'Base URL', config.baseUrl || profile.baseUrl);
    model = await promptWithDefault(rl, 'Model', config.model || profile.defaultModel);
    shouldSetKey = profile.requiresApiKey
      ? true
      : /^y(es)?$/i.test(await promptWithDefault(rl, 'Set optional API key? (y/N)', 'N'));
  } finally {
    if (ownsReadline) rl.close();
  }

  const next = {
    provider: profile.name,
    baseUrl,
    model
  };

  if (shouldSetKey) {
    const apiKey = await promptForSecret({ rl: options.rl, prompt: 'API key: ' });
    if (!apiKey.trim()) throw new Error('API key cannot be empty for this provider');
    next.apiKey = apiKey.trim();
  }

  await saveConfig(next);
  Object.assign(config, loadConfig({}));
  console.log('Saved secure local config. Run `codepark doctor` to verify.');
}

async function runKeySetup(config, options = {}) {
  const apiKey = await promptForSecret({ rl: options.rl, prompt: 'API key: ' });
  if (!apiKey.trim()) throw new Error('API key cannot be empty');
  await saveConfig({ apiKey: apiKey.trim() });
  Object.assign(config, loadConfig({}));
  console.log(config.secretStore === 'keychain'
    ? 'Saved API key in macOS Keychain.'
    : 'Saved API key in ~/.codepark/config.json with 0600 permissions.');
}

function printModelAuthHint(config) {
  const status = modelAuthStatus(config);
  if (status.ok) return;
  console.log('Model calls need setup: type /setup for provider config, /key to save only an API key, or /provider local for a local server.');
}

function printModelStart(config) {
  if (config.provider === 'codex') {
    console.log('Working via Codex CLI...');
  }
}

function printModelStatus(message) {
  console.error(message);
}

async function ensureModelAuth({ config, rl }) {
  const status = modelAuthStatus(config);
  if (status.ok) return true;
  if (!input.isTTY) {
    throw new Error('No API key configured. Run `codepark setup` in a terminal, or set CODEPARK_API_KEY.');
  }
  const answer = await promptWithDefault(rl, 'No API key configured. Open secure setup now? (Y/n)', 'Y');
  if (/^n(o)?$/i.test(answer.trim())) {
    console.log('Model call skipped. Use /setup or /key when ready.');
    return false;
  }
  await runSetup(config, { rl });
  const nextStatus = modelAuthStatus(config);
  if (!nextStatus.ok) {
    console.log(`Model call skipped: ${nextStatus.message}.`);
    return false;
  }
  return true;
}

async function promptForSecret({ rl, prompt }) {
  if (rl) rl.pause();
  try {
    return await promptHidden({ input, output, prompt });
  } finally {
    if (rl) rl.resume();
  }
}

async function promptWithDefault(rl, label, fallback) {
  const answer = await rl.question(`${label} [${fallback}]: `);
  return answer.trim() || fallback;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function appleScriptString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
