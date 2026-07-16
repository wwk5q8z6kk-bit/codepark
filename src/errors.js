export class CodeParkError extends Error {
  /**
   * @param {string} code Stable, machine-readable error code.
   * @param {string} message Human-readable error message.
   * @param {{ details?: any, cause?: any }=} options
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'CodeParkError';
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function normalizeError(error) {
  if (error instanceof CodeParkError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  if (error instanceof Error) {
    // Node errors commonly carry an error code (e.g., ENOENT).
    const code = typeof error.code === 'string' ? error.code : 'ERROR';
    return {
      code,
      message: error.message || code,
      details: undefined
    };
  }

  return {
    code: 'ERROR',
    message: String(error),
    details: undefined
  };
}

/**
 * JSON error contract for `--json` mode.
 * Always emit a single JSON object so callers can parse errors reliably.
 */
export function formatJsonError(error) {
  const normalized = normalizeError(error);
  return JSON.stringify({
    version: 1,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details !== undefined ? { details: normalized.details } : {})
    }
  });
}

export function exitCodeForError(error) {
  const normalized = normalizeError(error);
  // Industry standard: exit code 2 for CLI usage errors (bad args/flags/input).
  if (normalized.code === 'EARGS') return 2;
  if (normalized.code === 'EFLAGS') return 2;
  if (normalized.code === 'EJSON') return 2;
  if (normalized.code === 'ESHELL') return 2;
  return 1;
}
