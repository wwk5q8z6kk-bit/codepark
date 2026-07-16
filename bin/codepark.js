#!/usr/bin/env node
import { main } from '../src/cli.js';
import { exitCodeForError, formatJsonError } from '../src/errors.js';

await main().catch(error => {
  const wantsJson = process.argv.includes('--json');
  if (wantsJson) {
    // In structured mode, keep stdout machine-readable even on failure.
    console.log(formatJsonError(error));
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`codepark: ${message}`);
  }
  process.exitCode = exitCodeForError(error);
});
