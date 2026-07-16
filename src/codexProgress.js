const defaultCodexProgressIntervalMs = 15000;

export function readCodexProgressIntervalMs(value = process.env.CODEPARK_CODEX_PROGRESS_INTERVAL_MS) {
  if (value === undefined || value === '') return defaultCodexProgressIntervalMs;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return defaultCodexProgressIntervalMs;
}

export function formatCodexProgressMessage(elapsedMs) {
  return `Codex CLI still running (${formatElapsed(elapsedMs)} elapsed)...`;
}

function formatElapsed(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}
