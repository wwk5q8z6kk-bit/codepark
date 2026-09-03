import fs from 'node:fs/promises';
import path from 'node:path';
import { writeTextAtomic } from './atomicWrite.js';
import { createReadinessReport } from './readiness.js';
import { formatTaskList, listTasks } from './tasks.js';
import { listWorkers, readWorker } from './workers.js';
import { createWorkspacePolicyReport } from './workspacePolicy.js';

export async function createAgentDashboard(cwd, options = {}) {
  const taskPrefix = String(options.taskId ?? '').trim();
  const [tasks, workers] = await Promise.all([
    listTasks(cwd),
    listWorkers(cwd, { taskId: taskPrefix || undefined })
  ]);
  const visibleTasks = taskPrefix
    ? tasks.filter(task => task.id.startsWith(taskPrefix))
    : tasks;

  const dashboardTasks = [];
  for (const task of visibleTasks) {
    const taskWorkers = workers.filter(worker => worker.taskId === task.id);
    const agents = [];
    const shellWorkers = [];
    for (const worker of taskWorkers) {
      const summary = await summarizeWorker(cwd, worker, options);
      if (worker.kind === 'agent') agents.push(summary);
      else shellWorkers.push(summary);
    }
    dashboardTasks.push({
      ...task,
      agents,
      shellWorkers
    });
  }

  const allAgents = dashboardTasks.flatMap(task => task.agents);
  const allShellWorkers = dashboardTasks.flatMap(task => task.shellWorkers);
  return {
    cwd,
    tasks: dashboardTasks,
    totals: {
      tasks: dashboardTasks.length,
      agents: allAgents.length,
      runningAgents: allAgents.filter(worker => worker.status === 'running' || worker.status === 'starting').length,
      shellWorkers: allShellWorkers.length
    }
  };
}

export function formatAgentDashboard(dashboard) {
  if (!dashboard.tasks.length) return 'Agent Dashboard\nNo tasks.';
  const lines = [
    'Agent Dashboard',
    `tasks: ${dashboard.totals.tasks} | agents: ${dashboard.totals.agents} | running agents: ${dashboard.totals.runningAgents} | shell workers: ${dashboard.totals.shellWorkers}`
  ];
  for (const task of dashboard.tasks) {
    lines.push('');
    lines.push(formatTaskList([task]));
    if (!task.agents.length && !task.shellWorkers.length) {
      lines.push('  no workers');
      continue;
    }
    for (const agent of task.agents) {
      lines.push(formatWorkerBlock(agent, 'agent'));
    }
    for (const worker of task.shellWorkers) {
      lines.push(formatWorkerBlock(worker, 'worker'));
    }
  }
  return lines.join('\n');
}

export function formatAgentDashboardJson(dashboard) {
  return JSON.stringify({ version: 1, ...dashboard }, null, 2);
}

export async function createBrowserDashboard(cwd, config, options = {}) {
  const [dashboard, readiness, policy] = await Promise.all([
    createAgentDashboard(cwd, { taskId: options.taskId }),
    createReadinessReport(cwd, config),
    createWorkspacePolicyReport(cwd)
  ]);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    dashboard,
    readiness,
    policy
  };
  const relativePath = '.codepark/dashboard.html';
  const file = path.join(cwd, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeTextAtomic(file, renderDashboardHtml(payload));
  return {
    path: relativePath,
    absolutePath: file,
    payload
  };
}

export function formatBrowserDashboard(result) {
  return [
    `Wrote ${result.path}`,
    `Open: ${result.absolutePath}`
  ].join('\n');
}

function renderDashboardHtml(payload) {
  const data = safeJsonForScript(payload);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>CodePark Dashboard</title>',
    '<style>',
    ':root{color-scheme:light dark;--bg:#f7f7f4;--fg:#171717;--muted:#5f6368;--line:#d9d8d2;--ok:#167a3c;--bad:#a12b2b;--panel:#ffffff;--accent:#1f6feb}',
    '@media (prefers-color-scheme:dark){:root{--bg:#111214;--fg:#f1f1ef;--muted:#a0a4aa;--line:#303236;--panel:#181a1d;--accent:#7aa2ff}}',
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}',
    'header{padding:24px 28px 18px;border-bottom:1px solid var(--line);background:var(--panel)}h1{font-size:26px;margin:0 0 6px}h2{font-size:17px;margin:0 0 12px}h3{font-size:15px;margin:0 0 8px}.muted{color:var(--muted)}',
    'main{max-width:1180px;margin:0 auto;padding:22px 18px 40px}.grid{display:grid;gap:14px}.top{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:16px}.cols{grid-template-columns:minmax(0,1.5fr) minmax(280px,.8fr)}',
    '@media(max-width:850px){.cols{grid-template-columns:1fr}header{padding:20px 18px}}',
    '.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;min-width:0}.metric{font-size:28px;font-weight:700}.status{display:inline-flex;align-items:center;gap:6px;font-weight:650}.ok{color:var(--ok)}.bad{color:var(--bad)}',
    '.task{display:grid;gap:10px;border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.task:first-child{border-top:0;margin-top:0;padding-top:0}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pill{border:1px solid var(--line);border-radius:999px;padding:2px 8px;color:var(--muted);font-size:12px}',
    'pre{white-space:pre-wrap;word-break:break-word;margin:8px 0 0;background:rgba(127,127,127,.08);border:1px solid var(--line);border-radius:6px;padding:10px;max-height:220px;overflow:auto}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
    'table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid var(--line);padding:7px 0;vertical-align:top}th{color:var(--muted);font-weight:600}.empty{padding:20px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:8px}',
    '</style>',
    '</head>',
    '<body>',
    `<script id="codepark-data" type="application/json">${data}</script>`,
    '<header><h1>CodePark Dashboard</h1><div id="subtitle" class="muted"></div></header>',
    '<main><section id="app"></section></main>',
    '<script>',
    clientScript(),
    '</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

function clientScript() {
  return String(clientDashboardScript)
    .replace(/^function clientDashboardScript\(\) \{\/\*\n?/, '')
    .replace(/\n?\*\/\}$/, '');
}

function clientDashboardScript() {/*
const data = JSON.parse(document.getElementById('codepark-data').textContent);
const dashboard = data.dashboard;
const readiness = data.readiness;
const policy = data.policy.policy;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
document.getElementById('subtitle').textContent = `${dashboard.cwd} - generated ${data.generatedAt}`;

function metric(label, value, cls = '') {
  return `<div class="card"><div class="muted">${esc(label)}</div><div class="metric ${cls}">${esc(value)}</div></div>`;
}

function workerBlock(worker) {
  return `<div class="card">
    <h3>${esc(worker.kind)} ${esc(worker.id)}</h3>
    <div class="row">
      <span class="pill">${esc(worker.status)}</span>
      ${worker.turns == null ? '' : `<span class="pill">turns ${esc(worker.turns)}</span>`}
      ${worker.queuedMessages == null ? '' : `<span class="pill">queue ${esc(worker.queuedMessages)}</span>`}
      ${worker.processedMessages == null ? '' : `<span class="pill">processed ${esc(worker.processedMessages)}</span>`}
    </div>
    ${worker.sessionId ? `<div class="muted">session ${esc(worker.sessionId)}</div>` : ''}
    <div class="muted">log ${esc(worker.logPath)}</div>
    ${worker.lastMessage ? `<div><strong>Last message:</strong> ${esc(worker.lastMessage)}</div>` : ''}
    ${worker.recentLog ? `<pre><code>${esc(worker.recentLog)}</code></pre>` : ''}
  </div>`;
}

function taskBlock(task) {
  const workers = [...task.agents, ...task.shellWorkers];
  return `<article class="task">
    <div>
      <h3>${esc(task.title)}</h3>
      <div class="row">
        <span class="pill">${esc(task.id)}</span>
        <span class="pill">${esc(task.status)}</span>
        <span class="pill">priority ${esc(task.priority || 'normal')}</span>
        ${(task.labels || []).map(label => `<span class="pill">${esc(label)}</span>`).join('')}
      </div>
    </div>
    ${workers.length ? `<div class="grid">${workers.map(workerBlock).join('')}</div>` : '<div class="empty">No workers for this task</div>'}
  </article>`;
}

function checksTable(checks) {
  return `<table><tbody>${checks.map(item => `<tr><th>${esc(item.name)}</th><td class="${item.ok ? 'ok' : 'bad'}">${item.ok ? 'ok' : 'fail'}</td><td>${esc(item.message)}</td></tr>`).join('')}</tbody></table>`;
}

document.getElementById('app').innerHTML = `
  <section class="grid top">
    ${metric('Tasks', dashboard.totals.tasks)}
    ${metric('Agents', dashboard.totals.agents)}
    ${metric('Running Agents', dashboard.totals.runningAgents)}
    ${metric('Shell Workers', dashboard.totals.shellWorkers)}
    ${metric('Local Use', readiness.localUse.ready ? 'ready' : 'not ready', readiness.localUse.ready ? 'ok' : 'bad')}
  </section>
  <section class="grid cols">
    <div class="card">
      <h2>Tasks And Workers</h2>
      ${dashboard.tasks.length ? dashboard.tasks.map(taskBlock).join('') : '<div class="empty">No tasks</div>'}
    </div>
    <div class="grid">
      <div class="card">
        <h2>Readiness</h2>
        <div class="row"><span class="status ${readiness.localUse.ready ? 'ok' : 'bad'}">Local ${readiness.localUse.ready ? 'ready' : 'not ready'}</span><span class="status ${readiness.secureHarness.ready ? 'ok' : 'bad'}">Secure ${readiness.secureHarness.ready ? 'ready' : 'not ready'}</span></div>
        <h3>Local Checks</h3>${checksTable(readiness.checks.localUse)}
        <h3>Secure Harness</h3>${checksTable(readiness.checks.secureHarness)}
      </div>
      <div class="card">
        <h2>Workspace Policy</h2>
        <table><tbody>
          <tr><th>write allow</th><td>${esc(policy.write.allow.length ? policy.write.allow.join(', ') : 'workspace')}</td></tr>
          <tr><th>write deny</th><td>${esc(policy.write.deny.length ? policy.write.deny.join(', ') : 'none')}</td></tr>
          <tr><th>command deny</th><td>${esc(policy.commands.denyCommands.length ? policy.commands.denyCommands.join(', ') : 'none')}</td></tr>
          <tr><th>fragments</th><td>${esc(policy.commands.denyPatterns.length ? policy.commands.denyPatterns.join(', ') : 'none')}</td></tr>
        </tbody></table>
      </div>
    </div>
  </section>`;
*/}

function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

async function summarizeWorker(cwd, worker, options) {
  const read = await readWorker(cwd, worker.id, {
    maxBytes: options.maxLogBytes ?? 4000
  });
  return {
    id: worker.id,
    kind: worker.kind,
    status: worker.status,
    taskId: worker.taskId,
    sessionId: worker.agentSessionId || '',
    turns: worker.agentTurns ?? null,
    queuedMessages: worker.agentQueuedMessages ?? null,
    processedMessages: worker.agentProcessedMessages ?? null,
    logPath: worker.logPath,
    inboxPath: worker.messagePath || '',
    lastMessage: await readLastMessage(cwd, worker),
    recentLog: trimRecentLog(read.output, options.logLines ?? 8)
  };
}

function formatWorkerBlock(worker, label) {
  const heading = [
    `  ${label}: ${worker.id}`,
    worker.status,
    worker.turns == null ? '' : `turns: ${worker.turns}`,
    worker.queuedMessages == null ? '' : `queue: ${worker.queuedMessages}`,
    worker.processedMessages == null ? '' : `processed: ${worker.processedMessages}`,
    worker.sessionId ? `session: ${worker.sessionId}` : ''
  ].filter(Boolean).join(' | ');
  return [
    heading,
    worker.inboxPath ? `    inbox: ${worker.inboxPath}` : '',
    `    log: ${worker.logPath}`,
    worker.lastMessage ? `    last message: ${worker.lastMessage}` : '    last message: n/a',
    worker.recentLog ? `    recent log:\n${indent(worker.recentLog, '      ')}` : '    recent log: n/a'
  ].filter(Boolean).join('\n');
}

async function readLastMessage(cwd, worker) {
  if (!worker.messagePath) return '';
  const file = path.join(cwd, worker.messagePath);
  const text = await fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const record = JSON.parse(line);
      return String(record.message ?? '').trim();
    } catch {
      if (line.trim()) return line.trim();
    }
  }
  return '';
}

function trimRecentLog(output, lineCount) {
  const lines = String(output ?? '').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-Math.max(1, Number(lineCount) || 8)).join('\n');
}

function indent(value, prefix) {
  return String(value).split(/\r?\n/).map(line => `${prefix}${line}`).join('\n');
}
