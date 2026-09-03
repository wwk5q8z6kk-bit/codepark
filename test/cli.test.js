import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCheckpoint } from '../src/checkpoint.js';
import { buildVisibleTerminalLaunchCommand } from '../src/cli.js';
import { defaultLauncherName } from '../src/launcher.js';
import { addTask, listTasks } from '../src/tasks.js';
import { listWorkers, readWorker, stopWorker } from '../src/workers.js';
import { nodeCommand, writeNodeExecutable, writeNodeScript } from './helpers/platform.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mockMcpServer = path.join(root, 'fixtures', 'mock-mcp-server.js');

test('cli --version reports the package.json version', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-version-cli-'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const output = execFileSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--version'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  ).trim();

  assert.equal(output, pkg.version);
});

test('cli --help includes the package.json version', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-help-version-cli-'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const output = execFileSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--help'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  );

  assert.match(output, new RegExp(`^CodePark ${escapeRegExp(pkg.version)}\\b`, 'm'));
});

test('cli introspection commands do not require valid model config', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-introspection-cli-'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: configDir,
    CODEPARK_CONFIG_PATH: '',
    CODEPARK_PROVIDER: 'missing-provider',
    CODEPARK_LOCAL_ONLY: '1',
    CODEPARK_BASE_URL: 'https://api.openai.com/v1'
  };

  for (const args of [['--help'], ['--version'], ['providers']]) {
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'bin', 'codepark.js'), ...args],
      { cwd: root, encoding: 'utf8', env }
    );

    assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, new RegExp(`CodePark|${escapeRegExp(pkg.version)}|openai:`));
  }
});

test('cli accepts flags before command', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-'));
  const output = execFileSync(
    process.execPath,
    ['./bin/codepark.js', '--provider', 'codex', 'config'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  );

  const config = JSON.parse(output);
  assert.equal(config.provider, 'codex');
  assert.equal(config.baseUrl, 'codex://cli');
});

test('launch command builds secure workspace boot by default with interactive escape hatch', () => {
  const workspace = path.join(os.tmpdir(), 'codepark-launch-workspace');

  const boot = buildVisibleTerminalLaunchCommand(workspace, {
    noStart: true,
    noOpen: true,
    id: 'boot-app'
  });
  assert.match(boot, /--secure/);
  assert.match(boot, /--cwd/);
  assert.match(boot, /workspace-boot/);
  assert.match(boot, /--no-start/);
  assert.match(boot, /--no-open/);
  assert.match(boot, /boot-app/);

  const interactive = buildVisibleTerminalLaunchCommand(workspace, {
    interactive: true,
    secureMode: true,
    provider: 'codex'
  });
  assert.match(interactive, /--secure/);
  assert.match(interactive, /--provider/);
  assert.match(interactive, /codex/);
  assert.doesNotMatch(interactive, /workspace-boot/);
});

test('unknown provider is a usage error with structured JSON support', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-provider-error-cli-'));
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--provider', 'missing-provider', '--json', 'config'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  );

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.version, 1);
  assert.equal(payload.error.code, 'EARGS');
  assert.match(payload.error.message, /unknown provider: missing-provider/);
});

test('init writes examples into the configured workspace', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-init-workspace-'));
  const launchCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-init-launch-'));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'init'],
    {
      cwd: launchCwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wrote/);
  await fs.stat(path.join(workspace, '.codepark.example.env'));
  await fs.stat(path.join(workspace, '.codepark', 'hooks.example.json'));
  await fs.stat(path.join(workspace, '.codepark', 'skills', 'example-review.md'));
  await assert.rejects(
    () => fs.stat(path.join(launchCwd, '.codepark.example.env')),
    /ENOENT/
  );
});

test('init skips existing examples and writes missing ones', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-init-existing-workspace-'));
  await fs.writeFile(path.join(workspace, '.codepark.example.env'), 'existing\n');

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'init'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Skipped/);
  assert.equal(await fs.readFile(path.join(workspace, '.codepark.example.env'), 'utf8'), 'existing\n');
  await fs.stat(path.join(workspace, '.codepark', 'hooks.example.json'));
  await fs.stat(path.join(workspace, '.codepark', 'skills', 'example-review.md'));
});

test('harness-init writes inferred hooks into the configured workspace', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-cli-workspace-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    scripts: {
      check: 'node --check index.js',
      typecheck: 'tsc --noEmit',
      test: 'node --test',
      build: 'vite build'
    }
  }));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'harness-init'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wrote \.codepark\/hooks\.json/);
  assert.match(result.stdout, /verify \| npm run check && npm run typecheck && npm run test/);

  const config = JSON.parse(await fs.readFile(path.join(workspace, '.codepark', 'hooks.json'), 'utf8'));
  assert.deepEqual(config.hooks, {
    verify: ['npm run check', 'npm run typecheck', 'npm run test'],
    build: ['npm run build']
  });
});

test('doctor inspects the configured workspace', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-workspace-'));
  const launchCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-launch-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { verify: ['npm run verify'] }
  }));
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n');
  await fs.writeFile(path.join(workspace, '.codepark', 'tasks.json'), JSON.stringify({
    tasks: [
      { id: 'task-1', title: 'Open task', status: 'open' },
      { id: 'task-2', title: 'Done task', status: 'done' }
    ]
  }));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'doctor'],
    {
      cwd: launchCwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`ok workspace: ${escapeRegExp(workspace)}`));
  assert.match(result.stdout, /ok hooks: 1 hook configured/);
  assert.match(result.stdout, /ok skills: 1 local skill/);
  assert.match(result.stdout, /ok tasks: 1 open, 1 done/);
});

test('doctor can print structured JSON', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-json-workspace-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { verify: ['npm run verify'] }
  }));
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n');

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, '--provider', 'codex', 'doctor', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, 1);
  assert.equal(report.workspace.ok, true);
  assert.equal(report.workspace.message, workspace);
  assert.equal(report.provider.ok, true);
  assert.equal(report.provider.message, 'codex');
  assert.equal(report.hooks.ok, true);
  assert.match(report.hooks.message, /1 hook configured/);
  assert.equal(report.skills.ok, true);
  assert.match(report.skills.message, /1 local skill/);
});

test('doctor can probe configured MCP server health', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-mcp-workspace-'));
  await fs.writeFile(path.join(workspace, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [mockMcpServer] }
    }
  }));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'doctor', '--mcp-health'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /ok mcp: MCP health ok: mock: 1 tool/);
});

test('readiness command reports endpoint and product readiness', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-readiness-config-'));
  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--provider', 'codex', 'readiness', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, 1);
  assert.equal(report.endpoint.mode, 'codex-cli');
  assert.equal(report.endpoint.chatCompletionsUrl, 'codex CLI');
  assert.equal(report.package.name, 'codepark');
  assert.equal(report.package.license, 'MIT');
});

test('assess command reports project gaps and next actions', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-assess-command-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'assess-target',
    version: '1.0.0',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' },
    scripts: { test: 'node --test' }
  }));
  await fs.writeFile(path.join(workspace, 'README.md'), 'Private local project for personal use only.\n');

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'assess', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')),
        CODEPARK_CONFIG_PATH: '',
        CODEPARK_PROVIDER: 'codex'
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, 1);
  assert.equal(report.package.name, 'assess-target');
  assert.ok(report.gaps.some(gap => gap.includes('workspace: missing profile-init')));
});

test('assess-tasks command writes assessment gaps into local tasks', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-assess-tasks-command-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'assess-tasks-target',
    version: '1.0.0',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' },
    scripts: { test: 'node --test' }
  }));
  await fs.writeFile(path.join(workspace, 'README.md'), 'Private local project for personal use only.\n');
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-')),
    CODEPARK_CONFIG_PATH: '',
    CODEPARK_PROVIDER: 'codex'
  };

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'assess-tasks', '--json'],
    { cwd: root, encoding: 'utf8', env }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.version, 1);
  assert.ok(payload.added.length > 0);
  assert.ok(payload.added.every(task => task.labels.includes('assessment')));

  const repeat = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'assess-tasks', '--json'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(repeat.status, 0, repeat.stderr);
  const repeated = JSON.parse(repeat.stdout);
  assert.equal(repeated.added.length, 0);
  assert.equal(repeated.skipped.length, payload.added.length);
});

test('project command summarizes configured workspace package metadata', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-project-command-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'dogfood-target',
    version: '2.3.4',
    scripts: {
      test: 'node --test'
    },
    dependencies: {
      '@example/runtime': '^1.0.0'
    }
  }));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'project'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /dogfood-target@2\.3\.4/);
  assert.match(result.stdout, /scripts:/);
  assert.match(result.stdout, /dependencies:/);
  assert.doesNotMatch(result.stdout, /CodePark interactive mode/);
  await assert.rejects(() => fs.stat(path.join(workspace, '.codepark')), /ENOENT/);
});

test('scripts command summarizes configured workspace package scripts only', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-scripts-command-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'script-target',
    scripts: {
      check: 'node --check index.js',
      test: 'node --test'
    },
    dependencies: {
      '@example/runtime': '^1.0.0'
    }
  }));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'scripts'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /scripts:/);
  assert.match(result.stdout, /check: node --check index\.js/);
  assert.doesNotMatch(result.stdout, /dependencies:/);
  assert.doesNotMatch(result.stdout, /CodePark interactive mode/);
  await assert.rejects(() => fs.stat(path.join(workspace, '.codepark')), /ENOENT/);
});

test('workspace-plan command inspects launch, hooks, and setup gaps', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-plan-command-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'workspace-plan-target',
    version: '1.0.0',
    scripts: {
      dev: 'vite',
      check: 'eslint .',
      test: 'node --test'
    },
    dependencies: {
      vite: 'latest'
    }
  }));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'workspace-plan'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Workspace plan/);
  assert.match(result.stdout, /app types: node, vite/);
  assert.match(result.stdout, /launch: npm run dev \(package\)/);
  assert.match(result.stdout, /missing: profile-init, harness-init, launcher-install/);
  await assert.rejects(() => fs.stat(path.join(workspace, '.codepark')), /ENOENT/);

  const json = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'workspace-plan', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(json.status, 0, json.stderr);
  const plan = JSON.parse(json.stdout);
  assert.equal(plan.version, 1);
  assert.equal(plan.package.name, 'workspace-plan-target');
  assert.equal(plan.launch.command, 'npm run dev');
});

test('workspace-boot command initializes local harness and dashboard without opening or starting when disabled', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workspace-boot-command-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'workspace-boot-target',
    version: '1.0.0',
    scripts: {
      dev: 'vite',
      check: 'eslint .',
      test: 'node --test'
    }
  }));
  await fs.writeFile(path.join(workspace, 'README.md'), '# Workspace boot target\n');

  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'bin', 'codepark.js'),
      '--cwd',
      workspace,
      '--provider',
      'codex',
      'workspace-boot',
      '--no-start',
      '--no-open'
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Workspace boot/);
  assert.match(result.stdout, /ok profile: wrote/);
  assert.match(result.stdout, /ok harness: wrote/);
  assert.match(result.stdout, /ok launcher: wrote/);
  assert.match(result.stdout, /ok app: skipped/);
  await fs.stat(path.join(workspace, '.codepark', 'profile.json'));
  await fs.stat(path.join(workspace, '.codepark', 'hooks.json'));
  await fs.stat(path.join(workspace, defaultLauncherName()));
  await fs.stat(path.join(workspace, '.codepark', 'dashboard.html'));
});

test('profile commands initialize and read workspace profile', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-profile-command-'));
  await fs.writeFile(path.join(workspace, 'Makefile'), 'verify:\n\ttrue\n');
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };

  const initialized = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'profile-init'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(initialized.status, 0);
  assert.match(initialized.stdout, /Wrote \.codepark\/profile\.json/);
  assert.match(initialized.stdout, /hooks: verify/);

  const read = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'profile'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(read.status, 0);
  assert.match(read.stdout, /Workspace profile/);
  assert.match(read.stdout, /hooks: verify/);
});

test('policy commands inspect and check workspace policy', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-policy-command-'));
  await fs.mkdir(path.join(workspace, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      write: {
        allow: ['src/**'],
        deny: []
      },
      commands: {
        denyCommands: ['node']
      }
    }
  }, null, 2)}\n`);
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };

  const read = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'policy'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(read.status, 0);
  assert.match(read.stdout, /Workspace policy/);
  assert.match(read.stdout, /write allow: src\/\*\*/);

  const writeCheck = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'policy-check', 'write', 'README.md'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(writeCheck.status, 0);
  assert.match(writeCheck.stdout, /blocked write: README\.md/);

  const commandCheck = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, '--json', 'policy-check', 'command', '--', 'node', '--version'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(commandCheck.status, 0);
  const parsed = JSON.parse(commandCheck.stdout);
  assert.equal(parsed.allowed, false);
  assert.equal(parsed.type, 'command');
});

test('policy preset commands list and apply presets', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-policy-preset-command-'));
  await fs.writeFile(path.join(workspace, 'package.json'), `${JSON.stringify({
    scripts: { verify: 'node --test' }
  }, null, 2)}\n`);
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };

  const list = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'policy-presets'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(list.status, 0);
  assert.match(list.stdout, /node-app/);
  assert.match(list.stdout, /docs-only/);

  const applied = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'policy-preset', 'node-app'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(applied.status, 0);
  assert.match(applied.stdout, /preset: node-app/);

  const forced = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'policy-preset', 'docs-only', '--force'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(forced.status, 0);
  assert.match(forced.stdout, /preset: docs-only/);
  const profile = JSON.parse(await fs.readFile(path.join(workspace, '.codepark', 'profile.json'), 'utf8'));
  assert.deepEqual(profile.policy.write.allow, ['.codepark/**', 'README.md', 'CHANGELOG.md', 'docs/**', '*.md']);
});

test('launcher-install command writes a local launcher', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-launcher-command-'));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'launcher-install', '--target', 'OpenCodePark.command'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wrote OpenCodePark\.command/);
  const text = await fs.readFile(path.join(workspace, 'OpenCodePark.command'), 'utf8');
  assert.match(text, process.platform === 'win32' ? /where codepark/ : /command -v codepark/);
  assert.match(text, /--secure/);
  assert.match(text, /workspace-boot/);
  assert.match(text, process.platform === 'win32' ? /bin\\codepark\.js/ : /bin\/codepark\.js/);
});

test('install-local command bootstraps local CLI and workspace files', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-install-local-command-'));
  const binDir = path.join(workspace, 'bin');
  await fs.writeFile(path.join(workspace, 'package.json'), `${JSON.stringify({
    scripts: { verify: 'node --version' }
  }, null, 2)}\n`);

  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'bin', 'codepark.js'),
      '--cwd',
      workspace,
      'install-local',
      '--bin-dir',
      binDir
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /CodePark local install/);
  assert.match(result.stdout, /ok command/);
  if (process.platform === 'win32') {
    assert.match(await fs.readFile(path.join(binDir, 'codepark.cmd'), 'utf8'), /bin\\codepark\.js/);
  } else {
    assert.match(await fs.readlink(path.join(binDir, 'codepark')), /bin\/codepark\.js$/);
  }
  assert.match(await fs.readFile(path.join(workspace, '.codepark', 'hooks.json'), 'utf8'), /npm run verify/);
  assert.match(
    await fs.readFile(path.join(workspace, defaultLauncherName()), 'utf8'),
    process.platform === 'win32' ? /where codepark/ : /command -v codepark/
  );
});

test('container-runtime command reports workspace container files', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-container-workspace-'));
  await fs.writeFile(path.join(workspace, 'Containerfile'), 'FROM scratch\n');

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'container-runtime'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Container runtime/);
  assert.match(result.stdout, /files: Containerfile/);
});

test('compose commands use podman when available', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-compose-command-'));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-compose-command-bin-'));
  await fs.writeFile(path.join(workspace, 'compose.yaml'), 'services: {}\n');
  await writeNodeExecutable(bin, 'podman', "console.log(`cli podman ${process.argv.slice(2).join(' ')}`);");
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };

  const started = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'compose-start', '--detached', '--id', 'cli-compose'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(started.status, 0);
  assert.match(started.stdout, /Compose started: cli-compose/);
  assert.match(started.stdout, /command: podman compose up -d/);

  const worker = await waitForWorker(workspace, worker => worker.id === 'cli-compose' && worker.status !== 'running' && worker.status !== 'starting' && !isPidAlive(worker.pid));
  assert.equal(worker.status, 'done');

  const stopped = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'compose-stop'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(stopped.status, 0);
  assert.match(stopped.stdout, /Compose stopped/);
  assert.match(stopped.stdout, /cli podman compose down/);
});

test('skill package commands pack and install local skills', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skill-pack-source-'));
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skill-pack-target-'));
  await fs.mkdir(path.join(source, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(source, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');
  const packagePath = path.join(source, 'review.skill.json');

  const packed = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', source, 'skill-pack', 'review', 'review.skill.json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(packed.status, 0);
  assert.match(packed.stdout, /Skill package written/);

  const installed = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', target, 'skill-install', packagePath, 'shared-review'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(installed.status, 0);
  assert.match(installed.stdout, /Skill package installed/);
  assert.equal(
    await fs.readFile(path.join(target, '.codepark', 'skills', 'shared-review.md'), 'utf8'),
    '# Review\n\nCheck risks.\n'
  );
});

test('task commands manage the local task ledger non-interactively', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-task-command-'));
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };
  const run = (...args) => spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, ...args],
    { cwd: root, encoding: 'utf8', env }
  );

  const added = run('task-add', 'Run noninteractive task');
  assert.equal(added.status, 0);
  assert.match(added.stdout, /Task added:/);

  const listedOpen = run('tasks', 'open');
  assert.equal(listedOpen.status, 0);
  assert.match(listedOpen.stdout, /Run noninteractive task/);

  const completed = run('task-done', 'task-');
  assert.equal(completed.status, 0);
  assert.match(completed.stdout, /Task completed:/);

  const listedDone = run('tasks', 'done');
  assert.equal(listedDone.status, 0);
  assert.match(listedDone.stdout, /done \| Run noninteractive task/);

  const reopened = run('task-open', 'task-');
  assert.equal(reopened.status, 0);
  assert.match(reopened.stdout, /Task reopened:/);
  assert.deepEqual((await listTasks(workspace, { status: 'open' })).map(task => task.title), ['Run noninteractive task']);
});

test('task commands manage structured task metadata non-interactively', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-task-metadata-command-'));
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };
  const run = (...args) => spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, ...args],
    { cwd: root, encoding: 'utf8', env }
  );

  const dependency = run('task-add', 'Prepare CLI dependency');
  assert.equal(dependency.status, 0);
  const dependencyId = dependency.stdout.match(/^id: (.+)$/m)?.[1];
  assert.ok(dependencyId);

  const added = run(
    'task-add',
    '--priority', 'high',
    '--depends-on', dependencyId.slice(0, 12),
    '--label', 'agent',
    '--label', 'cli',
    '--notes', 'Needs dependency.',
    'Coordinate CLI metadata'
  );
  assert.equal(added.status, 0);
  assert.match(added.stdout, /priority: high/);
  assert.match(added.stdout, new RegExp(`dependsOn: ${dependencyId}`));
  const taskId = added.stdout.match(/^id: (.+)$/m)?.[1];
  assert.ok(taskId);

  const addedJson = run(
    'task-add',
    '--json',
    '--priority', 'normal',
    '--label', 'docs',
    '--notes', 'json add',
    'Coordinate CLI metadata JSON'
  );
  assert.equal(addedJson.status, 0, addedJson.stderr);
  const parsedAdd = JSON.parse(addedJson.stdout);
  assert.equal(parsedAdd.version, 1);
  assert.equal(parsedAdd.title, 'Coordinate CLI metadata JSON');
  assert.equal(parsedAdd.priority, 'normal');
  assert.deepEqual(parsedAdd.labels, ['docs']);
  assert.equal(parsedAdd.notes, 'json add');

  const blocked = run('tasks', 'blocked');
  assert.equal(blocked.status, 0);
  assert.match(blocked.stdout, /Coordinate CLI metadata/);
  assert.match(blocked.stdout, /blocked-by:/);
  assert.match(blocked.stdout, /labels:agent,cli/);

  const updated = run(
    'task-update',
    taskId,
    '--priority', 'low',
    '--label', 'docs',
    '--notes', 'Ready for docs.'
  );
  assert.equal(updated.status, 0);
  assert.match(updated.stdout, /Task updated:/);
  assert.match(updated.stdout, /priority: low/);

  const updatedJson = run(
    'task-update',
    '--json',
    taskId,
    '--priority', 'low',
    '--label', 'docs',
    '--notes', 'Ready for docs.'
  );
  assert.equal(updatedJson.status, 0, updatedJson.stderr);
  const parsedUpdated = JSON.parse(updatedJson.stdout);
  assert.equal(parsedUpdated.version, 1);
  assert.equal(parsedUpdated.id, taskId);
  assert.equal(parsedUpdated.title, 'Coordinate CLI metadata');
  assert.equal(parsedUpdated.priority, 'low');
  assert.deepEqual(parsedUpdated.labels, ['docs']);
  assert.equal(parsedUpdated.notes, 'Ready for docs.');

  const filtered = run('tasks', 'open', '--priority', 'low', '--label', 'docs');
  assert.equal(filtered.status, 0);
  assert.match(filtered.stdout, /Coordinate CLI metadata/);
  assert.doesNotMatch(filtered.stdout, /Prepare CLI dependency/);

  const filteredJson = run('tasks', 'open', '--priority', 'low', '--label', 'docs', '--json');
  assert.equal(filteredJson.status, 0, filteredJson.stderr);
  const parsedList = JSON.parse(filteredJson.stdout);
  assert.equal(parsedList.version, 1);
  assert.equal(parsedList.tasks.length, 1);
  assert.equal(parsedList.tasks[0].id, taskId);
  assert.equal(parsedList.tasks[0].title, 'Coordinate CLI metadata');
  assert.equal(parsedList.tasks[0].priority, 'low');
  assert.deepEqual(parsedList.tasks[0].labels, ['docs']);

  const detail = run('task-show', taskId);
  assert.equal(detail.status, 0);
  assert.match(detail.stdout, /Task detail:/);
  assert.match(detail.stdout, /notes: Ready for docs\./);

  const detailJson = run('task-show', '--json', taskId);
  assert.equal(detailJson.status, 0, detailJson.stderr);
  const parsedDetail = JSON.parse(detailJson.stdout);
  assert.equal(parsedDetail.version, 1);
  assert.equal(parsedDetail.id, taskId);
  assert.equal(parsedDetail.title, 'Coordinate CLI metadata');
  assert.equal(parsedDetail.priority, 'low');
  assert.deepEqual(parsedDetail.labels, ['docs']);
  assert.equal(parsedDetail.notes, 'Ready for docs.');

  const completedJson = run('task-done', '--json', taskId);
  assert.equal(completedJson.status, 0, completedJson.stderr);
  const parsedCompleted = JSON.parse(completedJson.stdout);
  assert.equal(parsedCompleted.version, 1);
  assert.equal(parsedCompleted.id, taskId);
  assert.equal(parsedCompleted.status, 'done');

  const reopenedJson = run('task-open', '--json', taskId);
  assert.equal(reopenedJson.status, 0, reopenedJson.stderr);
  const parsedReopened = JSON.parse(reopenedJson.stdout);
  assert.equal(parsedReopened.version, 1);
  assert.equal(parsedReopened.id, taskId);
  assert.equal(parsedReopened.status, 'open');
});

test('cli emits structured JSON errors when --json is set', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-json-errors-'));
  const env = {
    ...process.env,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };
  const run = (...args) => spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, ...args],
    { cwd: root, encoding: 'utf8', env }
  );

  const badStatus = run('tasks', 'nope', '--json');
  assert.equal(badStatus.status, 2);
  const statusError = JSON.parse(badStatus.stdout);
  assert.equal(statusError.version, 1);
  assert.equal(statusError.error.code, 'EARGS');
  assert.match(statusError.error.message, /tasks status must be open, done, or blocked/);

  const badFlag = run('--json', '--wat', 'x', 'tasks');
  assert.equal(badFlag.status, 2);
  const flagError = JSON.parse(badFlag.stdout);
  assert.equal(flagError.version, 1);
  assert.equal(flagError.error.code, 'EFLAGS');
  assert.match(flagError.error.message, /unknown flag: --wat/);
});

test('worker commands start and inspect task-scoped background workers', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-command-'));
  const task = await addTask(workspace, { title: 'Run worker command', now: '2026-04-18T12:00:00.000Z' });
  const command = [process.execPath, '-e', "console.log('command worker done')"];

  const started = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-start', task.id, '--', ...command],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(started.status, 0);
  assert.match(started.stdout, /Worker started:/);

  const worker = await waitForWorker(workspace, worker => worker.status !== 'running');
  assert.equal(worker.status, 'done');
  const listed = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'workers', task.id],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, new RegExp(worker.id));

  const read = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-read', worker.id],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(read.status, 0);
  assert.match(read.stdout, /command worker done/);

  const pruned = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-prune'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(pruned.status, 0);
  assert.match(pruned.stdout, /removed: 1/);
});

test('app-start command creates a managed app worker', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-command-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'node -e "console.log(\\"cli app started\\")"'
    }
  }));

  const started = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'app-start', '--id', 'cli-app'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(started.status, 0);
  assert.match(started.stdout, /App started: cli-app/);
  assert.match(started.stdout, /command: npm run dev/);

  const worker = await waitForWorker(workspace, worker => worker.id === 'cli-app' && worker.status !== 'running');
  assert.equal(worker.status, 'done');

  const read = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-read', 'cli-app'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(read.status, 0);
  assert.match(read.stdout, /cli app started/);
});

test('worker-prune --failed removes only failed worker records', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-prune-failed-'));
  await writeWorkerRecords(workspace, [
    { id: 'worker-failed', status: 'failed', exitCode: 1 },
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);

  const pruned = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-prune', '--failed'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(pruned.status, 0, pruned.stderr);
  assert.match(pruned.stdout, /removed: 1/);
  const workers = (await listWorkers(workspace)).map(worker => worker.id);
  assert.deepEqual(workers, ['worker-done']);
  await assert.rejects(() => fs.stat(path.join(workspace, '.codepark', 'workers', 'worker-failed.log')), /ENOENT/);
  await fs.stat(path.join(workspace, '.codepark', 'workers', 'worker-done.log'));
});

test('worker-prune --json emits structured prune metadata', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-prune-json-'));
  await writeWorkerRecords(workspace, [
    { id: 'worker-failed', status: 'failed', exitCode: 1 },
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);

  const pruned = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-prune', '--failed', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(pruned.status, 0, pruned.stderr);
  const result = JSON.parse(pruned.stdout);
  assert.equal(result.version, 1);
  assert.deepEqual(result.removed.map(worker => worker.id), ['worker-failed']);
  assert.deepEqual(result.kept.map(worker => worker.id), ['worker-done']);
  const workers = (await listWorkers(workspace)).map(worker => worker.id);
  assert.deepEqual(workers, ['worker-done']);
});

test('workers --json emits structured worker metadata', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-workers-json-command-'));
  const task = await addTask(workspace, { title: 'List JSON workers', now: '2026-04-18T12:00:00.000Z' });
  const command = [process.execPath, '-e', "console.log('json worker done')"];

  const started = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-start', task.id, '--', ...command],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(started.status, 0);
  const worker = await waitForWorker(workspace, worker => worker.status !== 'running');

  const listed = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'workers', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(listed.status, 0);
  const parsed = JSON.parse(listed.stdout);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.workers.length, 1);
  assert.equal(parsed.workers[0].id, worker.id);
  assert.equal(parsed.workers[0].taskId, task.id);
  assert.equal(parsed.workers[0].status, 'done');
});

test('worker-read --tail limits log output to recent lines', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-tail-command-'));
  const task = await addTask(workspace, { title: 'Tail worker log', now: '2026-04-18T12:00:00.000Z' });
  const command = [
    process.execPath,
    '-e',
    "console.log('line one'); console.log('line two'); console.log('line three')"
  ];

  const started = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-start', task.id, '--', ...command],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(started.status, 0);
  const worker = await waitForWorker(workspace, worker => worker.status !== 'running');

  const read = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-read', '--tail', '2', worker.id],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(read.status, 0);
  assert.doesNotMatch(read.stdout, /line one/);
  assert.match(read.stdout, /line two/);
  assert.match(read.stdout, /line three/);
});

test('worker-read --json emits structured log metadata', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-read-json-'));
  await writeWorkerRecords(workspace, [
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-read', '--json', 'worker-done'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const worker = JSON.parse(result.stdout);
  assert.equal(worker.version, 1);
  assert.equal(worker.id, 'worker-done');
  assert.equal(worker.status, 'done');
  assert.equal(worker.truncated, false);
  assert.match(worker.output, /worker-done output/);
});

test('agent command starts a task-scoped codex background worker', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-agent-command-'));
  const task = await addTask(workspace, { title: 'Run agent command', now: '2026-04-18T12:00:00.000Z' });
  const mockCodex = await writeMockExecutable(workspace, [
    '#!/usr/bin/env node',
    "console.log('cli mock codex invoked')",
    "console.log(JSON.stringify({ type: 'session_configured', thread_id: 'cli-thread' }))",
    "console.log(process.argv.slice(2).join('\\n'))"
  ]);

  const started = spawnSync(
    process.execPath,
    [
      path.join(root, 'bin', 'codepark.js'),
      '--cwd',
      workspace,
      'agent-start',
      task.id,
      'Review the worker subsystem.'
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CODEX_COMMAND: mockCodex,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(started.status, 0);
  assert.match(started.stdout, /Agent started:/);

  await waitForWorkerOutput(workspace, /cli mock codex invoked/);
  const worker = await waitForWorker(workspace, worker => worker.status === 'running');
  assert.equal(worker.kind, 'agent');
  assert.equal(worker.status, 'running');

  const read = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-read', worker.id],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(read.status, 0);
  assert.match(read.stdout, /cli mock codex invoked/);
  assert.match(read.stdout, /Review the worker subsystem/);
  await stopWorker(workspace, worker.id);
});

test('agent command logs Codex progress while a turn is running', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-agent-progress-command-'));
  const task = await addTask(workspace, { title: 'Run slow agent command', now: '2026-04-18T12:00:00.000Z' });
  const mockCodex = await writeMockExecutable(workspace, [
    '#!/usr/bin/env node',
    "const delay = ms => new Promise(resolve => setTimeout(resolve, ms));",
    "(async () => {",
    "  console.log(JSON.stringify({ type: 'session_configured', thread_id: 'slow-cli-thread' }));",
    "  await delay(120);",
    "  console.log('slow cli mock codex done');",
    "})().catch(error => {",
    "  console.error(error.stack || error.message);",
    "  process.exit(1);",
    "})"
  ]);

  const started = spawnSync(
    process.execPath,
    [
      path.join(root, 'bin', 'codepark.js'),
      '--cwd',
      workspace,
      'agent-start',
      task.id,
      'Review the slow worker subsystem.'
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CODEX_COMMAND: mockCodex,
        CODEPARK_CODEX_PROGRESS_INTERVAL_MS: '10',
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(started.status, 0);

  await waitForWorkerOutput(workspace, /Codex CLI still running \(.+elapsed\)/);
  const read = await waitForWorkerOutput(workspace, /slow cli mock codex done/);
  assert.match(read.output, /Codex CLI still running \(.+elapsed\)/);
  const worker = await waitForWorker(workspace, worker => worker.status === 'running');
  await stopWorker(workspace, worker.id);
});

test('worker-read --clean suppresses raw Codex JSON events', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-agent-clean-command-'));
  const task = await addTask(workspace, { title: 'Read clean agent logs', now: '2026-04-18T12:00:00.000Z' });
  const mockCodex = await writeMockExecutable(workspace, [
    '#!/usr/bin/env node',
    "console.log('clean mock codex invoked')",
    "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'clean-cli-thread' }))",
    "console.log(JSON.stringify({ type: 'turn.started' }))",
    "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Clean assistant summary.' }] } }))"
  ]);

  const started = spawnSync(
    process.execPath,
    [
      path.join(root, 'bin', 'codepark.js'),
      '--cwd',
      workspace,
      'agent-start',
      task.id,
      'Review clean worker logs.'
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CODEX_COMMAND: mockCodex,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );
  assert.equal(started.status, 0);

  await waitForWorkerOutput(workspace, /Clean assistant summary/);
  const worker = await waitForWorker(workspace, worker => worker.status === 'running');
  const read = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'worker-read', '--clean', worker.id],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(read.status, 0);
  assert.match(read.stdout, /clean mock codex invoked/);
  assert.match(read.stdout, /\[codex session: clean-cli-thread\]/);
  assert.match(read.stdout, /Clean assistant summary/);
  assert.doesNotMatch(read.stdout, /"thread.started"/);
  assert.doesNotMatch(read.stdout, /"item.completed"/);
  await stopWorker(workspace, worker.id);
});

test('agent-send command forwards follow-up messages to a running agent worker', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-agent-send-command-'));
  const task = await addTask(workspace, { title: 'Send agent follow-up', now: '2026-04-18T12:00:00.000Z' });
  const mockCodex = await writeMockExecutable(workspace, [
    '#!/usr/bin/env node',
    "const args = process.argv.slice(2)",
    "console.log(JSON.stringify({ type: 'session_configured', thread_id: 'cli-thread' }))",
    "if (args[0] === 'exec' && args[1] === 'resume') console.log('cli mock resume turn')",
    "else console.log('cli mock initial turn')",
    "console.log(args.join('\\n'))"
  ]);
  const env = {
    ...process.env,
    CODEPARK_CODEX_COMMAND: mockCodex,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };

  const started = spawnSync(
    process.execPath,
    [
      path.join(root, 'bin', 'codepark.js'),
      '--cwd',
      workspace,
      'agent-start',
      task.id,
      'Wait for follow-up.'
    ],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(started.status, 0);

  const sent = spawnSync(
    process.execPath,
    [
      path.join(root, 'bin', 'codepark.js'),
      '--cwd',
      workspace,
      'agent-send',
      'agent-',
      'continue with docs'
    ],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(sent.status, 0);
  assert.match(sent.stdout, /Agent message sent:/);

  const worker = await waitForWorker(workspace, worker => worker.status === 'running');
  await waitForWorkerOutput(workspace, /cli mock resume turn/);
  assert.equal(worker.status, 'running');
  const read = await readWorker(workspace, worker.id);
  assert.match(read.output, /cli mock initial turn/);
  assert.match(read.output, /cli mock resume turn/);
  assert.match(read.output, /continue with docs/);
  await stopWorker(workspace, worker.id);
});

test('code-index command summarizes local project symbols', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-code-index-command-'));
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'src', 'app.js'), [
    "import http from 'node:http';",
    'export function startServer(port) {',
    '  return http.createServer().listen(port);',
    '}',
    ''
  ].join('\n'));

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'code-index', 'start'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Code Symbols/);
  assert.match(result.stdout, /src\/app\.js:2/);
  assert.match(result.stdout, /function startServer/);
});

test('dashboard command shows task, agent, inbox, and recent log state', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-dashboard-command-'));
  const task = await addTask(workspace, { title: 'CLI dashboard task', now: '2026-04-18T12:00:00.000Z' });
  const mockCodex = await writeMockExecutable(workspace, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2)',
    "console.log(JSON.stringify({ type: 'session_configured', thread_id: 'cli-dashboard-thread' }))",
    "if (args[0] === 'exec' && args[1] === 'resume') console.log('cli dashboard resume')",
    "else console.log('cli dashboard initial')",
    "console.log(args.join('\\n'))"
  ]);
  const env = {
    ...process.env,
    CODEPARK_CODEX_COMMAND: mockCodex,
    CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
  };

  const started = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'agent-start', task.id, 'Prepare dashboard state.'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(started.status, 0);
  await waitForWorkerOutput(workspace, /cli dashboard initial/);

  const sent = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'agent-send', 'agent-', 'dashboard follow-up'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(sent.status, 0);
  await waitForWorkerOutput(workspace, /cli dashboard resume/);

  const dashboard = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'dashboard'],
    { cwd: root, encoding: 'utf8', env }
  );
  assert.equal(dashboard.status, 0);
  assert.match(dashboard.stdout, /Agent Dashboard/);
  assert.match(dashboard.stdout, /CLI dashboard task/);
  assert.match(dashboard.stdout, /agent-/);
  assert.match(dashboard.stdout, /running/);
  assert.match(dashboard.stdout, /cli-dashboard-thread/);
  assert.match(dashboard.stdout, /last message: dashboard follow-up/);
  assert.match(dashboard.stdout, /cli dashboard resume/);

  const worker = (await listWorkers(workspace))[0];
  await stopWorker(workspace, worker.id);
});

test('dashboard command can print structured JSON', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-dashboard-json-'));
  const task = await addTask(workspace, {
    title: 'CLI dashboard JSON task',
    priority: 'high',
    labels: ['json'],
    now: '2026-04-18T12:00:00.000Z'
  });

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, 'dashboard', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0);
  const dashboard = JSON.parse(result.stdout);
  assert.equal(dashboard.version, 1);
  assert.equal(dashboard.cwd, workspace);
  assert.equal(dashboard.totals.tasks, 1);
  assert.equal(dashboard.totals.agents, 0);
  assert.equal(dashboard.tasks[0].id, task.id);
  assert.equal(dashboard.tasks[0].title, 'CLI dashboard JSON task');
  assert.equal(dashboard.tasks[0].priority, 'high');
  assert.deepEqual(dashboard.tasks[0].labels, ['json']);
  assert.deepEqual(dashboard.tasks[0].agents, []);
  assert.deepEqual(dashboard.tasks[0].shellWorkers, []);
});

test('dashboard-html command writes a static browser dashboard', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-dashboard-html-'));
  await addTask(workspace, {
    title: 'CLI browser dashboard task',
    priority: 'high',
    labels: ['html'],
    now: '2026-04-18T12:00:00.000Z'
  });
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'cli-browser-dashboard-fixture',
    version: '1.0.0',
    bin: { codepark: 'bin/codepark.js' }
  }));
  await fs.writeFile(path.join(workspace, 'README.md'), '# CLI browser dashboard fixture\n');

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'bin', 'codepark.js'), '--cwd', workspace, '--provider', 'codex', 'dashboard-html'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'))
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Wrote \.codepark\/dashboard\.html/);
  assert.match(result.stdout, new RegExp(escapeRegExp(path.join(workspace, '.codepark', 'dashboard.html'))));

  const html = await fs.readFile(path.join(workspace, '.codepark', 'dashboard.html'), 'utf8');
  assert.match(html, /CodePark Dashboard/);
  assert.match(html, /CLI browser dashboard task/);
  assert.match(html, /Workspace Policy/);
});

test('onboard command saves codex as a no-key first-run provider', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-onboard-'));
  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', 'onboard'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /First-run setup/);
  assert.match(result.stdout, /Provider set to codex/);

  const output = execFileSync(
    process.execPath,
    ['./bin/codepark.js', 'config'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir
      }
    }
  );
  const config = JSON.parse(output);
  assert.equal(config.provider, 'codex');
  assert.equal(config.apiKey, '');
});

test('ask auto-saves a session transcript', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));

  execFileSync(
    process.execPath,
    ['./bin/codepark.js', 'ask', 'yourself'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  const sessions = await fs.readdir(sessionDir);
  assert.equal(sessions.length, 1);
  const body = JSON.parse(await fs.readFile(path.join(sessionDir, sessions[0]), 'utf8'));
  assert.equal(body.messages[0].content, 'yourself');
  assert.match(body.messages[1].content, /CodePark is this CLI/);
});

test('ask command reports Codex CLI progress on stderr', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-ask-progress-workspace-'));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const fakeCodexPath = await writeNodeScript(workspace, 'codex', `
const fs = require('node:fs/promises');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const outputIndex = process.argv.indexOf('--output-last-message');
  if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
    console.error('missing --output-last-message');
    process.exit(2);
  }

  await delay(80);
  await fs.writeFile(process.argv[outputIndex + 1], 'fake codex answer\\n');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
`);

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--provider', 'codex', '--no-stream', 'ask', 'Summarize this project.'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CODEX_COMMAND: nodeCommand(fakeCodexPath),
        CODEPARK_CODEX_PROGRESS_INTERVAL_MS: '10',
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Working via Codex CLI/);
  assert.match(result.stdout, /fake codex answer/);
  assert.match(result.stderr, /Codex CLI still running \(.+elapsed\)/);
});

test('resume command loads latest saved session', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  await fs.writeFile(path.join(sessionDir, '2026-01-01T00-00-00.000Z.json'), JSON.stringify({
    cwd: root,
    messages: [{ role: 'user', content: 'hello' }]
  }));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', 'resume'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Resumed 1 message/);
});

test('interactive mode reports and compacts token budget', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const sessionName = '2026-01-03T00-00-00.000Z.json';
  await fs.writeFile(path.join(sessionDir, sessionName), JSON.stringify({
    cwd: root,
    messages: Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `saved message ${index} ${'long context '.repeat(80)}`
    }))
  }));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', 'resume', sessionName],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/tokens\n/compact 2\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir,
        CODEPARK_CONTEXT_LIMIT_TOKENS: '1000',
        CODEPARK_COMPACT_THRESHOLD_TOKENS: '800'
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Estimated tokens:/);
  assert.match(result.stdout, /Context limit: 1000/);
  assert.match(result.stdout, /Auto-compact threshold: 800/);
  assert.match(result.stdout, /Compacted history:/);
});

test('interactive mode launches and calls configured MCP servers', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-mcp-workspace-'));
  await fs.writeFile(path.join(workspace, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [mockMcpServer] }
    }
  }));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/mcp\n/mcp-call mock echo {"text":"from-cli"}\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /mock/);
  assert.match(result.stdout, /echo/);
  assert.match(result.stdout, /echo:from-cli/);
});

test('interactive /grep supports quoted patterns', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-grep-workspace-'));
  await fs.mkdir(path.join(workspace, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'tasks.json'), JSON.stringify({
    tasks: [
      { id: 'task-1', title: 'Smoke test: run a worker', status: 'open' }
    ]
  }, null, 2));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/grep "Smoke test" .\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.codepark\/tasks\.json:\d+:.+Smoke test: run a worker/);
});

test('--local-only disables web command', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--local-only', 'web', 'https://example.com'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /web is disabled in local-only mode/);
});

test('--local-only disables /web in interactive mode', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-web-local-only-'));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--local-only'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/web https://example.com\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stderr, /\/web is disabled in local-only mode/);
});

test('--local-only disables doctor --mcp-health', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-local-only-'));
  await fs.writeFile(path.join(workspace, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [mockMcpServer] }
    }
  }));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--local-only', 'doctor', '--mcp-health'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /doctor --mcp-health is disabled in local-only mode/);
});

test('--secure refuses --yes auto-approval', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--secure', '--yes', 'config'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--yes is disabled in secure mode/);
});

test('--secure readiness reports secure local-only posture', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--secure', 'readiness', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_CONFIG_PATH: ''
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.endpoint.secureMode, true);
  assert.equal(report.endpoint.localOnly, true);
  assert.equal(report.endpoint.mode, 'codex-cli');
  assert.ok(report.checks.localUse.some(check => check.name === 'secure-mode' && check.ok));
});

test('interactive mode applies a patch file', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-patch-workspace-'));
  await fs.writeFile(path.join(workspace, 'a.txt'), 'old\n');
  await fs.writeFile(path.join(workspace, 'change.patch'), [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    ''
  ].join('\n'));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/patch change.patch\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Applied patch/);
  assert.equal(await fs.readFile(path.join(workspace, 'a.txt'), 'utf8'), 'new\n');
});

test('interactive mode can read notebooks', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-notebook-workspace-'));
  await fs.writeFile(path.join(workspace, 'demo.ipynb'), JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { language_info: { name: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# Title\\n'] },
      { cell_type: 'code', source: ['print(\"hi\")\\n'], outputs: [{ output_type: 'stream', text: ['hi\\n'] }] }
    ]
  }, null, 2));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/notebook demo.ipynb --include-outputs\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Notebook summary/);
  assert.match(result.stdout, /language: python/);
  assert.match(result.stdout, /Cell 2 \(code\)/);
  assert.match(result.stdout, /Output:/);
  assert.match(result.stdout, /hi/);
});

test('interactive doctor inspects the configured workspace', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-interactive-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { verify: ['npm run verify'] }
  }));
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n');
  await fs.writeFile(path.join(workspace, '.codepark', 'tasks.json'), JSON.stringify({
    tasks: [
      { id: 'task-1', title: 'Open task', status: 'open' },
      { id: 'task-2', title: 'Done task', status: 'done' }
    ]
  }));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/doctor\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`ok workspace: ${escapeRegExp(workspace)}`));
  assert.match(result.stdout, /ok hooks: 1 hook configured/);
  assert.match(result.stdout, /ok skills: 1 local skill/);
  assert.match(result.stdout, /ok tasks: 1 open, 1 done/);
});

test('interactive doctor can print structured JSON', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-json-interactive-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { verify: ['npm run verify'] }
  }));
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n');

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/doctor --json\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/\{[\s\S]*"mcp"[\s\S]*\}/);
  assert.ok(match);
  const report = JSON.parse(match[0]);
  assert.equal(report.workspace.ok, true);
  assert.equal(report.workspace.message, workspace);
  assert.equal(report.hooks.ok, true);
  assert.match(report.hooks.message, /1 hook configured/);
});

test('interactive doctor can probe configured MCP server health', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-doctor-mcp-interactive-'));
  await fs.writeFile(path.join(workspace, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [mockMcpServer] }
    }
  }));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/doctor --mcp-health\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /ok mcp: MCP health ok: mock: 1 tool/);
});

test('interactive mode runs the quality gate command', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-quality-workspace-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    scripts: {
      verify: 'node -e "console.log(\\"cli quality verified\\")"'
    }
  }));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/quality-gate\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Quality gate plan: npm run verify/);
  assert.match(result.stdout, /cli quality verified/);
  assert.match(result.stdout, /Quality gate passed/);
});

test('interactive mode creates and lists checkpoints', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-checkpoint-workspace-'));
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'codepark@example.test'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'CodePark Test'], { cwd: workspace });
  await fs.writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: workspace });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: workspace, stdio: 'ignore' });
  await fs.writeFile(path.join(workspace, 'tracked.txt'), 'changed\n');

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/checkpoint cli checkpoint\n/checkpoints\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Checkpoint created:/);
  assert.match(result.stdout, /cli checkpoint/);
});

test('interactive mode restores checkpoints', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-restore-workspace-'));
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'codepark@example.test'], { cwd: workspace });
  execFileSync('git', ['config', 'user.name', 'CodePark Test'], { cwd: workspace });
  await fs.writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: workspace });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: workspace, stdio: 'ignore' });
  await fs.writeFile(path.join(workspace, 'tracked.txt'), 'changed\n');
  const checkpoint = await createCheckpoint(workspace, { name: 'cli restore' });
  await fs.writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: `/restore-checkpoint ${checkpoint.id}\n/exit\n`,
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Checkpoint restored:/);
  assert.match(result.stdout, /cli restore/);
  assert.equal(await fs.readFile(path.join(workspace, 'tracked.txt'), 'utf8'), 'changed\n');
});

test('interactive mode keeps persistent shell session state', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-shell-workspace-'));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/shell-start dev\n/shell-send dev FOO=codepark\n/shell-send dev echo $FOO\n/shell-stop dev\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Shell session started: dev/);
  assert.match(result.stdout, /codepark/);
  assert.match(result.stdout, /Shell session stopped: dev/);
});

test('interactive mode stops shell sessions on exit', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-shell-exit-workspace-'));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/shell-start dev\n/exit\n',
      timeout: 2000,
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Shell session started: dev/);
});

test('interactive mode manages local task ledger', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-task-workspace-'));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/task-add Add native task ledger\n/tasks\n/task-done task-\n/tasks done\n/task-open task-\n/tasks open\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Task added:/);
  assert.match(result.stdout, /Add native task ledger/);
  assert.match(result.stdout, /Task completed:/);
  assert.match(result.stdout, /Task reopened:/);
});

test('interactive mode manages structured task metadata', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-task-metadata-workspace-'));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: [
        '/task-add --priority high --label agent --label slash --notes "Needs review." Coordinate slash metadata',
        '/tasks open --priority high --label slash',
        '/task-update task- --priority low --label docs --notes "Ready for docs."',
        '/task-update task- --priority low --label docs --notes "Ready for docs." --json',
        '/task-show task-',
        '/tasks open --priority low --label docs --json',
        '/tasks open --priority low --label docs',
        '/exit',
        ''
      ].join('\n'),
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Coordinate slash metadata/);
  assert.match(result.stdout, /priority: high/);
  assert.match(result.stdout, /labels:agent,slash/);
  assert.match(result.stdout, /Task updated:/);
  assert.match(result.stdout, /Task detail:/);
  assert.match(result.stdout, /notes: Ready for docs\./);
  assert.match(result.stdout, /priority: low/);
  assert.match(result.stdout, /labels:docs/);
  const jsonBlobs = [...result.stdout.matchAll(/\{\n[\s\S]*?\n\}/g)].map(match => match[0]);
  const updatedJsonText = jsonBlobs.find(text => (
    text.includes('"title": "Coordinate slash metadata"')
    && text.includes('"priority": "low"')
    && !text.includes('"tasks"')
  ));
  assert.ok(updatedJsonText);
  const parsedUpdated = JSON.parse(updatedJsonText);
  assert.equal(parsedUpdated.version, 1);
  assert.equal(parsedUpdated.priority, 'low');
  assert.deepEqual(parsedUpdated.labels, ['docs']);
  const listJsonText = jsonBlobs.find(text => (
    text.includes('"tasks"') && text.includes('"title": "Coordinate slash metadata"')
  ));
  assert.ok(listJsonText);
  const listed = JSON.parse(listJsonText);
  assert.equal(listed.version, 1);
  assert.equal(listed.tasks.length, 1);
  assert.equal(listed.tasks[0].priority, 'low');
  assert.deepEqual(listed.tasks[0].labels, ['docs']);
});

test('interactive mode emits structured JSON errors when --json is present', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-json-error-interactive-'));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: ['/tasks nope --json', '/exit', ''].join('\n'),
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/\{\"version\":1,\"error\":\{[\s\S]*?\}\}/);
  assert.ok(match);
  const payload = JSON.parse(match[0]);
  assert.equal(payload.version, 1);
  assert.equal(payload.error.code, 'EARGS');
  assert.match(payload.error.message, /\/tasks status must be open, done, or blocked/);
});

test('interactive mode can print structured task details', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-task-show-json-interactive-'));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: [
        '/task-add --priority high --label slash --notes "Structured detail." Coordinate task JSON',
        '/task-show --json task-',
        '/exit',
        ''
      ].join('\n'),
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/\{[\s\S]*"title": "Coordinate task JSON"[\s\S]*\}/);
  assert.ok(match);
  const task = JSON.parse(match[0]);
  assert.equal(task.status, 'open');
  assert.equal(task.priority, 'high');
  assert.deepEqual(task.labels, ['slash']);
  assert.equal(task.notes, 'Structured detail.');
});

test('interactive mode starts task-scoped background workers', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-workspace-'));
  const command = `${JSON.stringify(process.execPath)} -e "console.log('cli worker done')"`;

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: `/task-add Run worker from CLI\n/worker-start task- ${command}\n/exit\n`,
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Worker started:/);
  const worker = await waitForWorker(workspace, worker => worker.status !== 'running');
  const read = await readWorker(workspace, worker.id);
  assert.match(read.output, /cli worker done/);
});

test('interactive mode prunes only failed workers', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-prune-failed-interactive-'));
  await writeWorkerRecords(workspace, [
    { id: 'worker-failed', status: 'failed', exitCode: 1 },
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/worker-prune --failed\n/workers --json\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /removed: 1/);
  const workers = await listWorkers(workspace);
  assert.deepEqual(workers.map(worker => worker.id), ['worker-done']);
  assert.doesNotMatch(result.stdout, /worker-failed/);
});

test('interactive mode can print structured worker read metadata', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-read-json-interactive-'));
  await writeWorkerRecords(workspace, [
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/worker-read --json worker-done\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/\{[\s\S]*"id": "worker-done"[\s\S]*"output"[\s\S]*\}/);
  assert.ok(match);
  const worker = JSON.parse(match[0]);
  assert.equal(worker.id, 'worker-done');
  assert.equal(worker.status, 'done');
  assert.match(worker.output, /worker-done output/);
});

test('interactive mode can print structured worker prune metadata', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-worker-prune-json-interactive-'));
  await writeWorkerRecords(workspace, [
    { id: 'worker-failed', status: 'failed', exitCode: 1 },
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/worker-prune --failed --json\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/\{[\s\S]*"removed"[\s\S]*"kept"[\s\S]*\}/);
  assert.ok(match);
  const pruned = JSON.parse(match[0]);
  assert.deepEqual(pruned.removed.map(worker => worker.id), ['worker-failed']);
  assert.deepEqual(pruned.kept.map(worker => worker.id), ['worker-done']);
  const workers = await listWorkers(workspace);
  assert.deepEqual(workers.map(worker => worker.id), ['worker-done']);
});

test('interactive mode lists and runs configured hooks', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-hook-workspace-'));
  await fs.mkdir(path.join(workspace, '.codepark'));
  await fs.writeFile(path.join(workspace, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: ['node -e "console.log(\\"cli hook verified\\")"']
    }
  }));

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/hooks\n/hook verify\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /verify/);
  assert.match(result.stdout, /Hook passed: verify/);
  assert.match(result.stdout, /cli hook verified/);
});

test('interactive mode lists and reads local skills', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skill-workspace-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/skills review\n/skill review\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /review/);
  assert.match(result.stdout, /Local skill: review/);
  assert.match(result.stdout, /Check risks/);
});

test('interactive mode packs and installs local skill packages', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-config-'));
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-cli-sessions-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skill-package-workspace-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');

  const result = spawnSync(
    process.execPath,
    ['./bin/codepark.js', '--cwd', workspace, '--yes'],
    {
      cwd: root,
      encoding: 'utf8',
      input: '/skill-pack review review.skill.json\n/skill-install review.skill.json shared-review\n/skill shared-review\n/exit\n',
      env: {
        ...process.env,
        CODEPARK_CONFIG_DIR: configDir,
        CODEPARK_SESSION_DIR: sessionDir
      }
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Skill package written/);
  assert.match(result.stdout, /Skill package installed/);
  assert.match(result.stdout, /Local skill: shared-review/);
  assert.match(result.stdout, /Check risks/);
});

async function writeMockExecutable(directory, lines) {
  const file = await writeNodeScript(
    directory,
    `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    lines.join('\n')
  );
  return nodeCommand(file);
}

async function writeWorkerRecords(workspace, records) {
  await fs.mkdir(path.join(workspace, '.codepark', 'workers'), { recursive: true });
  const workers = records.map((record, index) => {
    const id = record.id;
    return {
      id,
      taskId: `task-${index + 1}`,
      taskTitle: `Task ${index + 1}`,
      kind: 'shell',
      command: `node ${id}.js`,
      cwd: workspace,
      status: record.status,
      pid: null,
      exitCode: record.exitCode ?? null,
      logPath: `.codepark/workers/${id}.log`,
      statusPath: `.codepark/workers/${id}.status.json`,
      createdAt: '2026-04-18T12:00:00.000Z',
      updatedAt: '2026-04-18T12:01:00.000Z'
    };
  });
  await fs.writeFile(path.join(workspace, '.codepark', 'workers.json'), `${JSON.stringify({ version: 1, workers }, null, 2)}\n`);
  for (const worker of workers) {
    await fs.writeFile(path.join(workspace, worker.statusPath), `${JSON.stringify(worker, null, 2)}\n`);
    await fs.writeFile(path.join(workspace, worker.logPath), `${worker.id} output\n`);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitForWorker(cwd, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const worker = (await listWorkers(cwd))[0];
    if (worker && predicate(worker)) return worker;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('worker did not reach expected state');
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

async function waitForWorkerOutput(cwd, pattern) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const worker = (await listWorkers(cwd))[0];
    if (worker) {
      const read = await readWorker(cwd, worker.id);
      if (pattern.test(read.output)) return read;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`worker output did not match ${pattern}`);
}
