# CodePark

CodePark is a terminal coding assistant CLI. It is intentionally small: it
gives you an interactive prompt, connects to an OpenAI-compatible chat
completion endpoint, exposes guarded tools for file inspection, exact file
edits, shell commands, MCP calls, and local skills.

CodePark is the harness around the model: it improves context, tool access,
approvals, checkpoints, and observability without depending on model training
changes.

> **Experimental:** CodePark is an early `0.1.x` project. Its core flows are
> tested, but model-provider behavior—especially with local models—can vary.
> Use scoped permissions and review its actions before relying on it in
> production or on critical systems.

CodePark is an open-source terminal coding assistant, distributed under the
[MIT License](LICENSE). It is maintained and run directly from this repository.

## Clean-Room Code

CodePark contains original application source and uses only Node.js built-in
modules at runtime. It does not bundle third-party playbooks or copied source.

## Contributing and Security

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for the
development and pull-request workflow. Please report vulnerabilities privately
as described in [SECURITY.md](SECURITY.md), not through public issues.

## Install Locally

```bash
cd /path/to/codepark
node ./bin/codepark.js install-local --force
```

This installs or updates the local `codepark` command, writes the workspace
profile and inferred hooks, and creates `CodePark.command` for secure local
workspace boot.

Then run:

```bash
codepark
```

`codepark` runs against the current directory by default. From another shell
location, pass the workspace explicitly:

```bash
codepark --cwd /path/to/app doctor
```

Or without linking:

```bash
node ./bin/codepark.js
```

## Bootstrap A Workspace

Run this from the app workspace you want CodePark to manage, or add
`--cwd /path/to/app` when running from another directory:

```bash
codepark install-local
```

If the workspace has a Compose file, start it as a managed worker:

```bash
codepark compose-start --detached
```

`compose-start` is intentionally skipped for workspaces without
`compose.yaml`, `compose.yml`, `docker-compose.yaml`, or `docker-compose.yml`.

## Configure

Use environment variables:

```bash
export CODEPARK_API_KEY="sk-..."
export CODEPARK_MODEL="gpt-4o-mini"
export CODEPARK_BASE_URL="https://api.openai.com/v1"
```

By default, `codepark setup` stores the API key in `~/.codepark/config.json`
with `0600` permissions. On macOS, opt into Keychain-backed API key storage:

```bash
export CODEPARK_SECRET_STORE=keychain
codepark setup
```

Or pick a built-in provider profile:

```bash
codepark --provider openai
codepark --provider openrouter
codepark --provider codex
codepark --provider ollama
```

`codex` uses your already-authenticated local Codex CLI login and does not
store an API key in CodePark. During long `ask`, interactive, and background
agent Codex runs, CodePark prints progress heartbeats every 15 seconds; set
`CODEPARK_CODEX_PROGRESS_INTERVAL_MS` to tune that interval, or to `0` to
disable it.

`agent-start`, `/agent-start`, and `start_agent_worker` use the `codex`
executable by default through a long-lived CodePark session driver. Set
`CODEPARK_CODEX_COMMAND` to use a different local Codex binary or wrapper.

For a local OpenAI-compatible server:

```bash
export CODEPARK_BASE_URL="http://localhost:11434/v1"
export CODEPARK_MODEL="your-local-model"
export CODEPARK_API_KEY="local"
```

For fully local operation, disable web and MCP features and require a local
model endpoint:

```bash
codepark --local-only --provider codex
CODEPARK_LOCAL_ONLY=1 codepark --provider ollama
```

Local-only mode accepts `codex://...` and `http(s)://localhost` base URLs.

For the safer local testing posture, use secure mode. It implies local-only
mode, refuses `--yes`, runs the Codex CLI backend with a read-only sandbox, and
keeps CodePark-managed actions behind explicit confirmation prompts:

```bash
codepark --secure --provider codex
CODEPARK_SECURE_MODE=1 codepark --provider codex
```

## Commands

```text
codepark                 Start interactive mode
codepark ask "prompt"    Run one prompt and exit
codepark resume [name]   Resume latest or named saved session
codepark launch          Open secure workspace boot in a visible macOS Terminal window
codepark onboard         Run first-run setup with Codex as the no-key default
codepark install-local   Install/update CLI, profile, hooks, and launcher
codepark config          Show resolved config with the key masked
codepark init            Write local env, hook, and skill examples
codepark harness-init    Infer project hooks into .codepark/hooks.json
codepark launcher-install
                          Write a clickable local launcher
codepark setup           Securely save local provider and API key config
codepark providers       List provider profiles
codepark provider codex  Save Codex CLI as the default no-key provider
codepark project         Show package scripts and dependencies
codepark scripts         Show package scripts only
codepark workspace-plan [--json]
                          Inspect app launch, hooks, profile, and next actions
codepark workspace-boot [--no-start] [--no-open] [--id id] [--json]
                          Initialize local harness, start app, and write dashboard
codepark assess [--json] Summarize readiness, gaps, and next actions
codepark assess-tasks [--json]
                          Write assessment gaps into local tasks
codepark profile         Show .codepark/profile.json if present
codepark profile-init    Write inferred hooks, runtime, and scoped policy
codepark policy          Show active workspace policy
codepark policy-check write|command <value>
                          Test a workspace policy decision
codepark policy-presets  List workspace policy presets
codepark policy-preset <name>
                          Apply a workspace policy preset
codepark container-runtime
                          Detect Podman/Docker support for this workspace
codepark compose-start   Start Podman/Docker Compose as a managed worker
codepark compose-stop    Run Podman/Docker Compose down
codepark skill-pack <id> <file>
                          Package a local skill as shareable JSON
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
                          Start a task-scoped Codex background agent
codepark agent-send <worker-id> <message>
                          Send a follow-up message to a running agent
codepark app-start [script] [--id id]
                          Start dev/start/serve as a managed worker
codepark worker-start <task-id> -- <command>
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
codepark doctor [--json] Check local setup and workflow files
codepark doctor --mcp-health
                          Also launch configured MCP servers and list tools
codepark readiness [--json]
                          Report endpoint and product readiness
codepark --local-only    Disable web and MCP features; require a local endpoint
codepark --secure        Local-only mode with explicit approvals required
codepark --provider openai
```

## Structured JSON Output

Some commands support `--json` for machine-readable output (tasks, workers, dashboard, doctor, and task mutations). Successful JSON responses are a single JSON object and include a top-level `version` (currently `1`).

When `--json` is present and a command fails, CodePark prints a single JSON error object to stdout and exits nonzero:

```json
{ "version": 1, "error": { "code": "EARGS", "message": "..." } }
```

Exit code conventions:

- `0`: success
- `2`: usage/validation errors (for example `EARGS`, `EFLAGS`, `EJSON`, `ESHELL`)
- `1`: all other errors

Commands that support `--json`:

| Command | Description |
| --- | --- |
| `tasks --json` | List local work items |
| `task-show --json` | Show a single work item (full metadata) |
| `task-add --json` | Add a local work item |
| `task-update --json` | Update a local work item |
| `task-done --json` | Mark a local work item done |
| `task-open --json` | Reopen a local work item |
| `workers --json` | List background workers |
| `worker-read --json` | Read worker logs (or tail logs) |
| `worker-prune --json` | Remove completed or failed worker records/logs |
| `dashboard --json` | Show task and agent dashboard |
| `doctor --json` | Check local setup and workflow files |
| `readiness --json` | Report endpoint and product readiness |
| `web --json` | Fetch a URL with size/time limits |

The full contract (including stable error codes) is documented in [docs/json-contract.md](docs/json-contract.md).

Inside interactive mode:

```text
/help
/config
/providers
/provider <name>
/setup
/key
/model <name>
/base-url <url>
/cwd <path>
/project
/scripts
/find <glob> [path]
/grep <text> [path]
/code-index [query]
/run <script>
/quality-gate
/ls [path]
/read <path>
/patch <path>
/shell <command>
/shell-start [id]
/shell-send <id> <command>
/shell-read <id>
/shells
/shell-stop <id>
/git
/diff [path]
/checkpoint [name]
/checkpoints
/restore-checkpoint <id>
/task-add [--json] [flags] <title>
/tasks [open|done|blocked] [flags]
/task-show [--json] <id>
/task-update <id> [--json] [flags]
/task-done <id> [--json]
/task-open <id> [--json]
/agent-start <task-id> <prompt>
/agent-send <worker-id> <message>
/worker-start <task-id> <command>
/workers [--json] [task-id]
/dashboard [--json] [task-id]
/dashboard-html [task-id]
/worker-read [--clean] [--json] [--tail n] <id>
/worker-stop <id>
/worker-prune [--failed] [--json]
/app-start [script] [--id id]
/workspace-plan [--json]
/workspace-boot [--no-start] [--no-open] [--id id] [--json]
/assess [--json]
/assess-tasks [--json]
/profile
/profile-init [--force]
/container-runtime
/compose-start [--detached] [--id id]
/compose-stop
/hooks
/hook <name>
/harness-init [--force]
/launcher-install [--target file] [--force]
/skills [query]
/skill <id>
/skill-pack <id> <file>
/skill-install <file> [id]
/save
/resume [name]
/sessions
/tokens
/compact [keep]
/mcp
/mcp-call <server> <tool> [json]
/doctor [--json] [--mcp-health]
/readiness [--json]
/clear
/exit
```

## Guardrails

- File writes, replacements, one-shot shell commands, and persistent shell session actions ask for confirmation.
- Patch application uses `git apply --check` before applying unified diffs.
- `/quality-gate` and `quality_gate` run project package scripts with approval, preferring `verify` and otherwise running available `check`, `lint`, `typecheck`, and `test` scripts.
- `codepark install-local` installs or updates the local command symlink, workspace profile, inferred hooks, and secure clickable launcher in one idempotent local setup flow.
- `codepark launch` opens a visible macOS Terminal window and runs secure `workspace-boot` for the current workspace. Add `--interactive` when you explicitly want the older interactive prompt instead of the boot harness.
- `codepark workspace-plan`, `/workspace-plan`, and `workspace_plan` inspect the current app without writing files: detected app type, launch command, inferred hooks, profile and launcher status, container files, missing setup pieces, and the next local commands to run.
- `codepark workspace-boot`, `/workspace-boot`, and `workspace_boot` turn that plan into local action: create missing profile/hooks/launcher files, optionally start the detected app as a managed worker, and write `.codepark/dashboard.html`. Use `--no-start` or `start: false` to skip app launch; use `--no-open` in CLI/slash mode to skip opening the browser. The model tool requires approval.
- `codepark assess`, `/assess`, and `project_assessment` produce a read-only project assessment that combines local testing readiness, secure-harness posture, workspace launch state, gaps, and next actions.
- `codepark assess-tasks`, `/assess-tasks`, and `create_assessment_tasks` write current assessment gaps into `.codepark/tasks.json` with `assessment` labels, skipping matching existing task titles unless `--force` or `force: true` is used. The model tool requires approval.
- `codepark harness-init`, `/harness-init`, and `init_harness` infer app-owned verification and build commands into `.codepark/hooks.json`, so CodePark can become the guarded local harness for an existing app without remote setup. Current adapters cover package scripts, Make targets, Go, Rust, Python, Java Gradle/Maven, PHP Composer/PHPUnit, and Ruby Rake. Existing hook configs are preserved unless `--force` or `force: true` is used.
- `codepark app-start`, `/app-start`, and `start_app` detect an app launch command and run it as a managed local worker with an automatically created task. Launch detection covers package scripts (`dev`, `start`, `serve`, `preview`), Make targets, Java Spring Boot Gradle/Maven apps, PHP Composer scripts or `public/index.php`, Ruby Rake/Rails/Rack apps, Compose files, and `.codepark/profile.json` app overrides. Use workers commands to read logs or stop it.
- `codepark profile-init`, `/profile-init`, and `init_profile` write `.codepark/profile.json`, a local workspace contract for inferred hooks, app launch overrides, workspace policy, and container runtime preferences. New Node, Python, Java, PHP, and Ruby workspaces default to scoped app policies, and unknown workspaces keep the basic default policy. `codepark profile`, `/profile`, and `read_profile` inspect it.
- `codepark policy`, `/policy`, and `read_policy` show the active workspace policy. `codepark policy-check`, `/policy-check`, and `check_policy` test whether a write path or shell command would be allowed before an agent acts. `codepark policy-presets`, `/policy-presets`, `list_policy_presets`, `codepark policy-preset`, `/policy-preset`, and `apply_policy_preset` list and apply preset policies such as `strict`, `node-app`, `python-app`, `java-app`, `php-app`, `ruby-app`, and `docs-only`.
- Workspace policy can deny write paths, optionally restrict writes to allowed paths, and block extra shell command names or command fragments per app. File writes, replacements, patch application, shell commands, hooks, and managed workers enforce this policy in addition to the built-in safety policy.
- `codepark container-runtime`, `/container-runtime`, and `container_runtime` detect local container support dynamically, preferring Podman when available and falling back to Docker. Detection also scans Compose files for risky settings such as privileged containers, host networking, host PID/IPC sharing, Docker socket mounts, host root mounts, home-directory mounts, device mappings, capability additions, and security-option overrides.
- `codepark compose-start`, `/compose-start`, and `compose_start` run Podman/Docker Compose as a managed worker, preferring Podman. Compose startup refuses critical container risks by default. `codepark compose-stop`, `/compose-stop`, and `compose_stop` run the matching Compose `down`.
- `codepark launcher-install`, `/launcher-install`, and `install_launcher` write a local `CodePark.command` launcher so the workspace can be booted with CodePark from Finder or a shell. The launcher runs secure `workspace-boot`, falls back to this repo's `bin/codepark.js` when a global `codepark` command is not on `PATH`, prints boot status and next commands, and waits for Return before closing.
- `/checkpoint` and `create_checkpoint` save tracked git diffs plus copied untracked files under `.codepark/checkpoints` without changing the working tree.
- `/restore-checkpoint` and `restore_checkpoint` validate saved patches with `git apply --check` before restoring checkpoint contents.
- `codepark task-add`, `/task-add`, `codepark tasks`, `/tasks`, `codepark task-show`, `/task-show`, `codepark task-update`, `/task-update`, `codepark task-done`, `/task-done`, `codepark task-open`, `/task-open`, and their model tools maintain a local ignored work ledger in `.codepark/tasks.json`. Tasks support `low`/`normal`/`high` priorities, labels, notes, exact persisted dependencies, structured mutation output through `task-add --json`, `/task-add --json`, or `add_task` with `json: true`, `task-update --json`, `/task-update --json`, or `update_task` with `json: true`, `task-done --json`, `/task-done --json`, or `complete_task` with `json: true`, `task-open --json`, `/task-open --json`, or `reopen_task` with `json: true`, structured list output through `tasks --json`, `/tasks --json`, or `list_tasks` with `json: true`, full detail inspection, structured detail output through `task-show --json`, `/task-show --json`, or `show_task` with `json: true`, and a derived `blocked` list filter for open tasks with unfinished dependencies.
- `codepark code-index`, `/code-index`, `code_index`, and `find_code_symbols` build a local source-code index for JS/TS and Python symbols/imports, so agents can locate definitions and understand project shape before editing.
- `codepark agent-start`, `/agent-start`, and `start_agent_worker` run durable Codex CLI background agents scoped to an open task. The session driver keeps the worker alive after the initial Codex turn, records the Codex session id when available, resumes that session for follow-up turns, and replays unprocessed persisted inbox messages after a runner restart. Agent sessions have bounded turns and inbox queues so autonomous follow-up loops cannot grow without limit. `codepark agent-send`, `/agent-send`, and `send_agent_message` persist follow-up messages in the agent inbox and deliver them to the running session driver.
- `codepark dashboard`, `/dashboard`, and `agent_dashboard` show a local read-only task/agent dashboard with compact task metadata, worker status, session ids, inbox queue/processed counts, inbox last messages, and recent logs. Use `dashboard --json`, `/dashboard --json`, or `agent_dashboard` with `json: true` for structured task, agent, shell worker, and total metadata. `codepark dashboard-html`, `codepark dashboard-open`, `/dashboard-html`, and `agent_dashboard_html` write `.codepark/dashboard.html`, a static local browser dashboard that combines tasks, workers, readiness, and workspace policy state without starting a server.
- `codepark worker-start`, `/worker-start`, and `start_worker` run durable background shell commands scoped to an open task. Worker metadata is stored in `.codepark/workers.json`, logs are stored under `.codepark/workers/`, `workers`, `worker-read`, and `worker-stop` inspect or stop shell or agent workers, and `worker-prune`, `/worker-prune`, or `prune_workers` removes completed worker records and logs. Use `worker-prune --failed`, `/worker-prune --failed`, or `prune_workers` with `failed_only: true` to remove only failed worker records and logs. Use `worker-prune --json`, `/worker-prune --json`, or `prune_workers` with `json: true` for structured removed/kept metadata. Use `workers --json`, `/workers --json`, or `list_workers` with `json: true` for structured worker metadata. Use `worker-read --json`, `/worker-read --json`, or `read_worker` with `json: true` for structured log metadata. Use `worker-read --clean`, `/worker-read --clean`, or `read_worker` with `clean: true` to suppress raw Codex JSON events in agent logs while keeping session, progress, and assistant text visible. Add `worker-read --tail n`, `/worker-read --tail n`, or `read_worker` with `tail_lines` for shorter live log inspection.
- Running or starting workers whose recorded process no longer exists are recovered to `failed` with `failureReason: "process not found"` and that recovered status is written back to the worker status file.
- Managed workers have a max runtime budget. Workers that exceed it are failed with `failureReason: "max runtime exceeded: ..."` and their logs record the timeout.
- Session transcripts, task ledgers, worker ledgers/status files, agent configs, and agent runner state are written through temp-file-plus-rename atomic writes.
- `/hooks`, `/hook`, `list_hooks`, and `run_hook` use explicit project hooks from `.codepark/hooks.json`; running a hook requires approval and each command still passes the shell safety policy.
- `/skills`, `/skill`, `list_skills`, and `read_skill` expose project-owned local markdown skills from `.codepark/skills/`.
- `codepark skill-pack`, `/skill-pack`, and `pack_skill` write a single local markdown skill to a portable `codepark.skill-package.v1` JSON file; `codepark skill-install`, `/skill-install`, and `install_skill_package` install that package back into `.codepark/skills/`.
- `codepark doctor`, `/doctor`, and the `doctor` model tool report the inspected workspace, installed `codepark` command, secure clickable launcher, secure config permissions, provider setup, MCP config, and local hook, skill, task ledger, and worker status. Use `codepark doctor --json`, `/doctor --json`, or the `doctor` tool with `json: true` for structured health-check output. Use `codepark doctor --mcp-health`, `/doctor --mcp-health`, or the `doctor` tool with `mcp_health: true` to launch configured MCP servers and verify their tool-list response.
- `codepark readiness`, `/readiness`, and the `readiness` model tool report endpoint mode, local-use readiness, secure-harness readiness, and project metadata. Secure-harness readiness requires `--secure` or `CODEPARK_SECURE_MODE=1`, a ready launcher, scoped write policy, sensitive-path denies, and command publication blocks. Use `--json` or `json: true` for automation.
- Workspace paths are confined under the active workspace directory.
- Obvious destructive shell commands are blocked.
- Persistent shell sessions preserve cwd and environment across approved commands, with `/shell-read` and `/shell-stop` for output and cleanup. CodePark also stops live sessions on CLI exit.
- Git commands are read-only.
- MCP support reads `.codepark.mcp.json`, launches configured stdio servers, lists tools with `/mcp`, calls tools with `/mcp-call`, and exposes MCP calls to model tool use.
- Sessions auto-save to `~/.codepark/sessions`; use `codepark resume` or `/resume` to continue work.
- `/tokens` shows estimated context usage, and `/compact` summarizes older history while preserving recent messages.
- CodePark auto-compacts saved history when it crosses the configured threshold and the summary would reduce context size.
- CodePark launches without an API key. Model calls guide you into setup from the terminal interface when a remote provider needs a key.
- Fresh interactive launches prompt for first-run provider setup when no config or provider environment is present; Codex CLI is the default and needs no CodePark API key.
- Project-local `AGENTS.md`, `.codepark/rules.md`, and `.codepark/instructions.md` are loaded into model context.
- Use `codepark setup`, `/setup`, or `/key` for API keys. The key is entered with no terminal echo and saved in `~/.codepark/config.json` with `0600` permissions by default, or in macOS Keychain when `CODEPARK_SECRET_STORE=keychain`.
- The CLI does not claim a command passed unless it has tool output.
