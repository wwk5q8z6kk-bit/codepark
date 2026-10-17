import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createAgentDashboard,
  createBrowserDashboard,
  formatAgentDashboard,
  formatBrowserDashboard
} from '../src/dashboard.js';
import { addTask } from '../src/tasks.js';
import { listWorkers, readWorker, sendAgentMessage, startAgentWorker, stopWorker } from '../src/workers.js';

test('agent dashboard summarizes tasks, agent status, inbox, session, and logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-dashboard-'));
  const task = await addTask(root, {
    title: 'Dashboard task',
    priority: 'high',
    labels: ['agent', 'dashboard'],
    now: '2026-04-18T12:00:00.000Z'
  });
  const mockCodex = await writeMockCodexSession(root);

  await startAgentWorker(root, {
    taskId: task.id,
    prompt: 'Start dashboard agent.',
    id: 'agent-dashboard',
    codexCommand: [process.execPath, mockCodex]
  });
  await waitForWorkerOutput(root, 'agent-dashboard', /mock initial turn/);
  await sendAgentMessage(root, 'agent-dashboard', 'continue dashboard');
  await waitForWorkerOutput(root, 'agent-dashboard', /mock resume turn/);
  await waitForWorkerStatus(root, 'agent-dashboard', worker => worker.agentProcessedMessages === 1);

  const dashboard = await createAgentDashboard(root);
  assert.equal(dashboard.tasks.length, 1);
  assert.equal(dashboard.tasks[0].agents.length, 1);
  assert.equal(dashboard.tasks[0].agents[0].id, 'agent-dashboard');
  assert.equal(dashboard.tasks[0].agents[0].queuedMessages, 0);
  assert.equal(dashboard.tasks[0].agents[0].processedMessages, 1);
  assert.equal(dashboard.tasks[0].agents[0].lastMessage, 'continue dashboard');
  assert.match(dashboard.tasks[0].agents[0].recentLog, /mock resume turn/);

  const formatted = formatAgentDashboard(dashboard);
  assert.match(formatted, /Agent Dashboard/);
  assert.match(formatted, new RegExp(task.id));
  assert.match(formatted, /Dashboard task/);
  assert.match(formatted, /priority:high/);
  assert.match(formatted, /labels:agent,dashboard/);
  assert.match(formatted, /agent-dashboard/);
  assert.match(formatted, /running/);
  assert.match(formatted, /queue: 0/);
  assert.match(formatted, /processed: 1/);
  assert.match(formatted, /thread-dashboard/);
  assert.match(formatted, /last message: continue dashboard/);
  assert.match(formatted, /mock resume turn/);

  await stopWorker(root, 'agent-dashboard');
});

test('browser dashboard writes static HTML with readiness and policy state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-browser-dashboard-'));
  await addTask(root, {
    title: 'Browser dashboard task',
    priority: 'high',
    labels: ['html'],
    now: '2026-04-18T12:00:00.000Z'
  });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'browser-dashboard-fixture',
    version: '1.0.0',
    bin: { codepark: 'bin/codepark.js' }
  }));
  await fs.writeFile(path.join(root, 'README.md'), '# Browser dashboard fixture\n');
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      write: {
        allow: ['.codepark/**', 'src/**'],
        deny: ['.git/**']
      },
      commands: {
        denyCommands: ['sudo'],
        denyPatterns: ['npm publish']
      }
    }
  }, null, 2)}\n`);

  const result = await createBrowserDashboard(root, {
    provider: 'codex',
    baseUrl: 'codex://cli',
    model: 'codex-cli-default',
    localOnly: true,
    secureMode: true
  });

  assert.equal(result.path, '.codepark/dashboard.html');
  assert.match(formatBrowserDashboard(result), /Wrote \.codepark\/dashboard\.html/);
  assert.equal(result.payload.dashboard.totals.tasks, 1);
  assert.deepEqual(result.payload.policy.policy.write.allow, ['.codepark/**', 'src/**']);

  const html = await fs.readFile(result.absolutePath, 'utf8');
  assert.match(html, /CodePark Dashboard/);
  assert.match(html, /Browser dashboard task/);
  assert.match(html, /Workspace Policy/);
  assert.match(html, /codepark-data/);
  const jsonPayload = html.match(/<script id="codepark-data" type="application\/json">([\s\S]+?)<\/script>/)?.[1];
  assert.ok(jsonPayload);
  assert.doesNotMatch(jsonPayload, /&quot;/);
  assert.equal(JSON.parse(jsonPayload).dashboard.tasks[0].title, 'Browser dashboard task');
});

async function writeMockCodexSession(root) {
  const file = path.join(root, 'mock-dashboard-codex.js');
  await fs.writeFile(file, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2)',
    "console.log(JSON.stringify({ type: 'session_configured', thread_id: 'thread-dashboard' }))",
    "if (args[0] === 'exec' && args[1] === 'resume') console.log('mock resume turn')",
    "else console.log('mock initial turn')",
    "console.log(args.join('\\n'))"
  ].join('\n'));
  return file;
}

async function waitForWorkerOutput(cwd, id, pattern) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const worker = await readWorker(cwd, id).catch(() => null);
    if (worker && pattern.test(worker.output)) return worker;
    await listWorkers(cwd);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`worker output did not match ${pattern}: ${id}`);
}

async function waitForWorkerStatus(cwd, id, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const worker = (await listWorkers(cwd)).find(worker => worker.id === id);
    if (worker && predicate(worker)) return worker;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`worker status did not match expected state: ${id}`);
}
