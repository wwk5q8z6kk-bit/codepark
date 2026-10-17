import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildComposeCommand,
  detectContainerRuntime,
  formatComposeStart,
  formatComposeStop,
  formatContainerRuntime,
  scanContainerRisks,
  startCompose,
  stopCompose,
  validateContainerRisks
} from '../src/containerRuntime.js';
import { readWorker } from '../src/workers.js';
import { writeNodeExecutable } from './helpers/platform.js';

test('detectContainerRuntime prefers podman and reports compose files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-runtime-'));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-bin-'));
  await fs.writeFile(path.join(root, 'compose.yaml'), 'services: {}\n');
  await writeNodeExecutable(bin, 'docker');
  await writeNodeExecutable(bin, 'podman');
  await writeNodeExecutable(bin, 'podman-compose');

  const result = await detectContainerRuntime(root, { path: bin });
  assert.equal(result.runtime, 'podman');
  assert.equal(result.command, 'podman');
  assert.equal(result.composeCommand, 'podman compose');
  assert.deepEqual(result.files, ['compose.yaml']);
  assert.equal(result.available.docker, true);
  assert.equal(result.available.podman, true);
  assert.match(formatContainerRuntime(result), /Podman is preferred/);
});

test('detectContainerRuntime falls back to docker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-runtime-'));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-bin-'));
  await fs.writeFile(path.join(root, 'Dockerfile'), 'FROM scratch\n');
  await writeNodeExecutable(bin, 'docker');

  const result = await detectContainerRuntime(root, { path: bin });
  assert.equal(result.runtime, 'docker');
  assert.equal(result.composeCommand, 'docker compose');
  assert.deepEqual(result.files, ['Dockerfile']);
});

test('buildComposeCommand uses detected podman compose command', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-runtime-'));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-bin-'));
  await fs.writeFile(path.join(root, 'compose.yaml'), 'services: {}\n');
  await writeNodeExecutable(bin, 'podman');

  const runtime = await detectContainerRuntime(root, { path: bin });
  assert.equal(buildComposeCommand(runtime, ['up', '-d']), 'podman compose up -d');
});

test('scanContainerRisks reports risky compose settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-risks-'));
  await fs.writeFile(path.join(root, 'compose.yaml'), [
    'services:',
    '  app:',
    '    privileged: true',
    '    network_mode: host',
    '    volumes:',
    '      - /:/host',
    '      - $HOME/.ssh:/root/.ssh',
    '    cap_add:',
    '      - SYS_ADMIN',
    ''
  ].join('\n'));

  const risks = await scanContainerRisks(root, ['compose.yaml']);
  assert.ok(risks.some(risk => risk.level === 'critical' && /privileged/.test(risk.message)));
  assert.ok(risks.some(risk => risk.level === 'critical' && /host networking/.test(risk.message)));
  assert.ok(risks.some(risk => risk.level === 'critical' && /root filesystem/.test(risk.message)));
  assert.ok(risks.some(risk => risk.level === 'warning' && /home directory/.test(risk.message)));
  assert.ok(risks.some(risk => risk.level === 'warning' && /capability/.test(risk.message)));
  assert.throws(
    () => validateContainerRisks(risks),
    /Refusing compose-start/
  );
});

test('detectContainerRuntime includes compose risk scan results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-risk-detect-'));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-bin-'));
  await fs.writeFile(path.join(root, 'compose.yaml'), 'services:\n  app:\n    network_mode: host\n');
  await writeNodeExecutable(bin, 'podman');

  const runtime = await detectContainerRuntime(root, { path: bin });
  assert.equal(runtime.risks.length, 1);
  assert.match(formatContainerRuntime(runtime), /Container risk scan/);
  assert.match(formatContainerRuntime(runtime), /host networking/);
});

test('startCompose refuses critical container risks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-compose-risk-'));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-compose-risk-bin-'));
  await fs.writeFile(path.join(root, 'compose.yaml'), 'services:\n  app:\n    privileged: true\n');
  await writeNodeExecutable(bin, 'podman', "console.log('should not run');");
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;

  try {
    await assert.rejects(
      () => startCompose(root, { id: 'compose-risk', detached: true }),
      /critical container risks/
    );
  } finally {
    process.env.PATH = previousPath;
  }
});

test('compose lifecycle prefers podman and records worker output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-compose-runtime-'));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-compose-bin-'));
  await fs.writeFile(path.join(root, 'compose.yaml'), 'services: {}\n');
  await writeNodeExecutable(bin, 'podman', "console.log(`fake podman ${process.argv.slice(2).join(' ')}`);");
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;

  try {
    const started = await startCompose(root, { id: 'compose-test', detached: true });
    assert.equal(started.runtime, 'podman');
    assert.equal(started.command, 'podman compose up -d');
    assert.match(formatComposeStart(started), /Compose started: compose-test/);

    const worker = await waitForWorkerExit(root, 'compose-test');
    assert.equal(worker.status, 'done');
    const read = await readWorker(root, 'compose-test');
    assert.match(read.output, /fake podman compose up -d/);

    const stopped = await stopCompose(root);
    assert.equal(stopped.runtime, 'podman');
    assert.equal(stopped.command, 'podman compose down');
    assert.match(formatComposeStop(stopped), /fake podman compose down/);
  } finally {
    process.env.PATH = previousPath;
  }
});

async function waitForWorkerExit(root, id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const read = await readWorker(root, id).catch(() => null);
    if (read?.status && read.status !== 'running' && read.status !== 'starting' && !isPidAlive(read.pid)) return read;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${id}`);
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
