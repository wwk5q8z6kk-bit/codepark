import { spawn } from 'node:child_process';
import { createSubprocessEnv } from './env.js';
import { defaultShell, isWindows } from './platform.js';

const sessions = new Map();
let nextId = 1;
let nextMarker = 1;

export function startShellSession(cwd, options = {}) {
  const id = normalizeSessionId(options.id) || `shell-${nextId++}`;
  if (sessions.has(id)) throw new Error(`shell session already exists: ${id}`);
  const shell = options.shell || defaultShell();
  const child = spawn(shell, [], {
    cwd,
    env: createSubprocessEnv(process.env),
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const session = {
    id,
    cwd,
    shell,
    child,
    output: '',
    readOffset: 0,
    closed: false,
    exitCode: null
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => appendOutput(session, chunk));
  child.stderr.on('data', chunk => appendOutput(session, chunk));
  child.on('exit', code => {
    session.closed = true;
    session.exitCode = code;
  });
  child.on('error', error => {
    session.closed = true;
    appendOutput(session, `${error.message}\n`);
  });
  child.stdin.setDefaultEncoding('utf8');
  sessions.set(id, session);
  return publicSession(session);
}

export async function sendShellSessionCommand(id, command, options = {}) {
  const session = getSession(id);
  if (session.closed || session.child.killed) throw new Error(`shell session is closed: ${id}`);
  const marker = `__CODEPARK_DONE_${Date.now()}_${nextMarker++}__`;
  const startOffset = session.output.length;
  session.child.stdin.write(formatShellSessionInput(command, marker));
  const slice = await waitForMarker(session, marker, options.timeoutMs ?? 30000, startOffset);
  const match = slice.match(new RegExp(`\\r?\\n?${marker}:(\\d+)\\r?\\n?`));
  if (!match) throw new Error(`shell session command did not report completion: ${id}`);
  session.readOffset = session.output.length;
  return {
    id,
    command,
    exitCode: Number(match[1]),
    output: slice.slice(0, match.index).trim()
  };
}

export function readShellSession(id) {
  const session = getSession(id);
  const output = session.output.slice(session.readOffset);
  session.readOffset = session.output.length;
  return { id, output: output.trim(), closed: session.closed, exitCode: session.exitCode };
}

export function stopShellSession(id) {
  const session = getSession(id);
  terminateShellProcessTree(session);
  sessions.delete(id);
  return publicSession({ ...session, closed: true });
}

export function listShellSessions() {
  return Array.from(sessions.values()).map(publicSession);
}

export function stopAllShellSessions() {
  const stopped = [];
  for (const id of Array.from(sessions.keys())) {
    try {
      stopped.push(stopShellSession(id));
    } catch {
      sessions.delete(id);
    }
  }
  return stopped;
}

export function formatShellSessionStarted(session) {
  return [
    `Shell session started: ${session.id}`,
    `shell: ${session.shell}`,
    `cwd: ${session.cwd}`
  ].join('\n');
}

export function formatShellSessionCommand(result) {
  return [
    `Shell session: ${result.id}`,
    `exit: ${result.exitCode}`,
    result.output || '[no output]'
  ].join('\n');
}

export function formatShellSessionRead(result) {
  return [
    `Shell session: ${result.id}`,
    `status: ${result.closed ? `closed (${result.exitCode ?? 'unknown'})` : 'running'}`,
    result.output || '[no new output]'
  ].join('\n');
}

export function formatShellSessionList(shellSessions) {
  if (!shellSessions.length) return 'No shell sessions.';
  return shellSessions.map(session => [
    session.id,
    session.closed ? `closed (${session.exitCode ?? 'unknown'})` : 'running',
    session.cwd
  ].join(' | ')).join('\n');
}

export function formatShellSessionStopped(session) {
  return `Shell session stopped: ${session.id}`;
}

function getSession(id) {
  const session = sessions.get(String(id ?? '').trim());
  if (!session) throw new Error(`unknown shell session: ${id}`);
  return session;
}

function appendOutput(session, chunk) {
  session.output += chunk;
  const max = 200000;
  if (session.output.length > max) {
    const trimBy = session.output.length - max;
    session.output = session.output.slice(trimBy);
    session.readOffset = Math.max(0, session.readOffset - trimBy);
  }
}

function waitForMarker(session, marker, timeoutMs, startOffset) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (session.closed) {
        clearInterval(timer);
        reject(new Error(`shell session closed before command completed: ${session.id}`));
        return;
      }
      const slice = session.output.slice(startOffset);
      if (slice.includes(marker)) {
        clearInterval(timer);
        resolve(slice);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`shell session command timed out: ${session.id}`));
      }
    }, 10);
  });
}

function publicSession(session) {
  return {
    id: session.id,
    cwd: session.cwd,
    shell: session.shell,
    closed: session.closed,
    exitCode: session.exitCode
  };
}

function formatShellSessionInput(command, marker) {
  if (isWindows()) return `${command}\r\n@echo ${marker}:%ERRORLEVEL%\r\n`;
  return `${command}\nprintf '\\n${marker}:%s\\n' "$?"\n`;
}

function terminateShellProcessTree(session) {
  if (isWindows() && session.child.pid) {
    const taskkill = spawn('taskkill', ['/PID', String(session.child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
    taskkill.on('error', () => session.child.kill('SIGTERM'));
    return;
  }
  if (process.platform !== 'win32' && session.child.pid) {
    try {
      process.kill(-session.child.pid, 'SIGTERM');
      return;
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        appendOutput(session, `${error.message}\n`);
      }
    }
  }
  session.child.kill('SIGTERM');
}

function normalizeSessionId(value) {
  const id = String(value ?? '').trim();
  if (!id) return '';
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error('shell session id may contain only letters, numbers, dot, underscore, and dash');
  }
  return id;
}
