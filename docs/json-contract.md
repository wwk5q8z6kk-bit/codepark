# CodePark JSON Contract (v1)

This document defines the stable, machine-readable JSON conventions used by CodePark commands that support `--json`.

## Commands That Support `--json`

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

## General Rules

- JSON is written to stdout.
- Successful JSON output is a single JSON object.
- Error JSON output is a single JSON object and the process exits nonzero.
- New fields may be added without a version bump. Existing fields should not be removed or renamed within the same contract version.

## Compatibility Policy (v1)

CodePark aims to make `--json` output safe for automation. Treat `version: 1` as a stable contract with the following rules:

- Clients must ignore unknown fields and tolerate new optional fields.
- Allowed without a version bump: adding fields, adding new error codes, and adding new commands that support `--json`.
- Requires a version bump (for example to `2`): removing/renaming fields, changing types or meanings, changing exit code semantics, or changing the envelope shapes.
- Deprecation in `version: 1`: document the deprecation here first, keep the field present and correct, and only remove it when `version` is bumped.
- The error contract (`{ version: 1, error: { code, message, details? } }`) and exit code mapping are part of the stable v1 surface. New error codes may be added; existing codes should not change meaning.

## Success Envelope

Every current JSON-emitting command includes a top-level version:

```json
{ "version": 1 }
```

Commands then add their own payload fields (for example, `tasks`, `workers`, or task metadata fields like `id` and `title`).

## Error Envelope

When `--json` is present and a command fails, CodePark emits:

```json
{
  "version": 1,
  "error": {
    "code": "EARGS",
    "message": "tasks status must be open, done, or blocked",
    "details": { "optional": "extra structured context" }
  }
}
```

`details` is optional and may be omitted.

## Exit Codes

- `0`: success
- `2`: Usage errors (invalid args/flags/input). These are the errors with codes `EARGS`, `EFLAGS`, `EJSON`, `ESHELL`.
- `1`: All other errors.

## Error Codes

CodePark uses stable error codes for common CLI parsing and validation failures:

- `EARGS`: Missing/invalid arguments (wrong status value, missing id, missing title, etc.)
- `EFLAGS`: Unknown flag or invalid flag usage
- `ESHELL`: Shell operators are not supported in certain slash-command argument parsers
- `EJSON`: Invalid JSON payloads (for example `/mcp-call` args parsing)

Other errors may use:

- `ENOENT`, `EACCES`, etc. (Node.js filesystem error codes) when an underlying OS call fails
- `ERROR` when no more specific code is available

## Interactive Mode Notes

Interactive mode is optimized for humans. When a slash command includes `--json` and fails, CodePark prints a JSON error object, but the session may also contain other human-readable output before/after it.

For automation, prefer non-interactive invocations like `codepark tasks --json`.
