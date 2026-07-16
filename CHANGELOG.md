# Changelog

All notable local CodePark changes are documented here.

## Unreleased

### Changed

- Marked CodePark as experimental in its README and project metadata,
  including guidance for safe use with provider and local-model variability.
- Kept CodePark source-only.

### Added

- Task-scoped Codex background agents through `agent-start`, `/agent-start`, and `start_agent_worker`, using a long-lived session driver that captures the Codex session id and resumes it for follow-up turns.
- Follow-up messaging for running Codex background agents through `agent-send`, `/agent-send`, and `send_agent_message`, sharing the existing worker log/read/stop/prune lifecycle.
- Local task/agent dashboard through `dashboard`, `/dashboard`, and `agent_dashboard`, showing agent status, session ids, inbox last messages, and recent logs.
- Local code intelligence through `code-index`, `/code-index`, `code_index`, and `find_code_symbols`, indexing JS/TS and Python definitions/imports without a network service.
- Durable agent inbox recovery: restarted session runners skip completed initial turns, replay only unprocessed persisted follow-ups, and surface queued/processed message counts in worker status.
- Atomic JSON writes for session transcripts, task ledgers, worker ledgers/status files, agent configs, and agent runner state.
- Structured task metadata across CLI, slash commands, model tools, and dashboard output, including priority, labels, notes, exact dependencies, full task detail views, and derived blocked-task filtering.
- Task mutation JSON output through `task-add --json`, `/task-add --json`, and `add_task` with `json: true`, `task-update --json`, `/task-update --json`, and `update_task` with `json: true`, `task-done --json`, `/task-done --json`, and `complete_task` with `json: true`, and `task-open --json`, `/task-open --json`, and `reopen_task` with `json: true`.
- Task list JSON output through `tasks --json`, `/tasks --json`, and `list_tasks` with `json: true`.
- Task detail JSON output through `task-show --json`, `/task-show --json`, and `show_task` with `json: true`.
- Dynamic syntax checking through `node ./bin/check-syntax.js`, covering current and future JavaScript files under `bin/`, `src/`, `test/`, and `fixtures/` without maintaining a manual file list.
- Local `release-check` and `release-check:fast` scripts for full and fast release gates with package dry-run validation.
- Top-level `project` and `scripts` commands for shell-friendly read-only project orientation without entering interactive mode.
- Periodic Codex CLI progress heartbeats during long `ask`, interactive, and background agent model runs.
- Clean worker log reads through `worker-read --clean`, `/worker-read --clean`, and `read_worker` with `clean: true`, suppressing raw Codex JSON events while keeping readable agent output.
- Worker list JSON output through `workers --json`, `/workers --json`, and `list_workers` with `json: true`.
- Dashboard JSON output through `dashboard --json`, `/dashboard --json`, and `agent_dashboard` with `json: true`.
- Doctor JSON output through `doctor --json`, `/doctor --json`, and `doctor` with `json: true`.
- Failed-worker-only pruning through `worker-prune --failed`, `/worker-prune --failed`, and `prune_workers` with `failed_only: true`.
- Worker prune JSON output through `worker-prune --json`, `/worker-prune --json`, and `prune_workers` with `json: true`.
- Worker read JSON output through `worker-read --json`, `/worker-read --json`, and `read_worker` with `json: true`.
- Worker log tailing through `worker-read --tail`, `/worker-read --tail`, and `read_worker` with `tail_lines`.
- Release-check temp worker process leak guard, failing the gate when tests leave CodePark worker/session runner processes behind.
- Structured JSON error output when `--json` is set, emitting a single `{ version: 1, error: { code, message } }` payload with nonzero exit codes for argument/flag validation failures.
- Slash command parsers now use stable error codes (`EARGS`, `EFLAGS`, `ESHELL`, `EJSON`) so interactive `--json` errors are machine-readable.
- JSON contract docs at `docs/json-contract.md`, describing the v1 envelope, error object, and stable error codes.
- Exit code conventions: usage/validation errors now exit with code `2` (instead of `1`) to match common CLI tooling expectations.
- Documented `--json` command support and exit code conventions in `README.md` and `docs/json-contract.md`.
- JSON fixture tests for the v1 contract in `test/jsonFixtures.test.js`, backed by golden files under `test/fixtures/json/`.
- Cross-platform `smoke:task-json` now uses Node (`docs/smoke-task-json.js`) instead of bash, and JSON error fixtures cover common usage failures.
- Task and worker domain validation errors now use stable `EARGS` codes (for example not found / ambiguous prefix), so `--json` failures exit with code `2` consistently.
- Golden JSON fixtures now cover worker resolution errors (`worker-read --json` not found / ambiguous prefix).
- Golden JSON fixtures for task mutation/detail outputs (`task-add/update/done/open/show --json`) under `test/fixtures/json/`.
- Documented the JSON output compatibility policy for `version: 1` in `docs/json-contract.md` (additive changes, deprecation, and version bump rules).

### Fixed

- Worker stop and prune now wait for process groups to exit and escalate stubborn workers, preventing orphaned background agent/session processes after tests or interrupted runs.
- Running or starting workers whose recorded process is gone now recover to a persisted `failed` status with a `process not found` failure reason.

## [0.1.0] - 2026-04-19

### Added

- Terminal CLI with interactive mode, one-shot `ask`, visible macOS launcher, local setup, provider profiles, and no-key Codex/Ollama/local provider modes.
- Guarded developer tools for project overview, file listing and reading, grep/glob-style search, package scripts, file writes, replacements, patches, read-only git inspection, and shell execution.
- Persistent shell sessions with preserved cwd/environment, guarded command sends, output reads, and process cleanup on CLI exit.
- Saved chat sessions with resume support, manual save/list commands, token budget reporting, manual compaction, and automatic compaction when useful.
- Workspace MCP support for stdio server config, tool listing, tool calls, model-facing MCP tools, and optional doctor health probes.
- Local workflow primitives: task ledger, task-scoped background workers, worker log reading, worker pruning, project hooks, local markdown skills, and skill package import/export.
- Patch checkpoints that save tracked diffs and untracked file copies, with guarded restore validation.
- Doctor diagnostics for provider setup, workspace path, secure config permissions, MCP config, hooks, skills, task ledgers, worker ledgers, and optional MCP launch/tool-list health.
- Optional macOS Keychain-backed API key storage through `CODEPARK_SECRET_STORE=keychain`.
- Local verification workflow using Node.js test and syntax-check commands.

### Fixed

- Self-reference prompts such as "yourself" resolve to CodePark status instead of falling through to model auth.
- Init scaffolding is idempotent and skips existing local examples.
- Persistent shell sessions and background workers clean up process groups more reliably.
- Hook, MCP, task, and worker configuration diagnostics validate malformed local workflow files.
- Top-level `worker-start ... -- <argv>` preserves shell quoting for commands such as `node -e "console.log('ok')"`.

### Notes

- This project began as a local-only private development effort.
- No remote repository or PR workflow is assumed.
