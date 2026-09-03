import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTools } from '../src/tools.js';
import { defaultLauncherName } from '../src/launcher.js';
import { listWorkers, readWorker, stopWorker } from '../src/workers.js';
import { nodeCommand, writeNodeExecutable, writeNodeScript } from './helpers/platform.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mockMcpServer = path.join(repoRoot, 'fixtures', 'mock-mcp-server.js');

test('read_file reads workspace files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(root, 'a.txt'), 'hello');
  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('read_file', { path: 'a.txt' });
  assert.match(result, /hello/);
});

test('read_notebook renders a compact cell summary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      language_info: { name: 'python' }
    },
    cells: [
      { cell_type: 'markdown', source: ['# Title\n', 'Hello\n'] },
      {
        cell_type: 'code',
        source: ['print("hi")\n'],
        outputs: [{ output_type: 'stream', text: ['hi\n'] }]
      }
    ]
  };
  await fs.writeFile(path.join(root, 'demo.ipynb'), JSON.stringify(notebook, null, 2));
  const tools = createTools({ cwd: root, assumeYes: true });

  const result = await tools.execute('read_notebook', { path: 'demo.ipynb', include_outputs: true });

  assert.match(result, /demo\.ipynb/);
  assert.match(result, /cells: 2/);
  assert.match(result, /language: python/);
  assert.match(result, /Cell 1 \(markdown\)/);
  assert.match(result, /# Title/);
  assert.match(result, /Cell 2 \(code\)/);
  assert.match(result, /print\(\"hi\"\)/);
  assert.match(result, /Output:/);
  assert.match(result, /hi/);
});

test('web_fetch fetches URL content with approval bypassed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain');
    res.end('hello from server');
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;

  try {
    const tools = createTools({ cwd: root, assumeYes: true });
    const result = await tools.execute('web_fetch', { url, max_bytes: 1000, timeout_ms: 10000 });
    assert.match(result, /Status: 200/);
    assert.match(result, /hello from server/);
  } finally {
    server.close();
  }
});

test('web_fetch can return structured JSON', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain');
    res.end('hello-json');
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;

  try {
    const tools = createTools({ cwd: root, assumeYes: true });
    const result = await tools.execute('web_fetch', { url, json: true, max_bytes: 1000, timeout_ms: 10000 });
    const parsed = JSON.parse(result);
    assert.equal(parsed.status, 200);
    assert.equal(parsed.url, url);
    assert.equal(parsed.bodyText, 'hello-json');
    assert.equal(parsed.truncated, false);
  } finally {
    server.close();
  }
});

test('local-only tool schemas hide network and MCP tools', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const tools = createTools({ cwd: root, assumeYes: true, config: { localOnly: true } });
  const names = tools.schemas.map(schema => schema.function.name);
  const doctor = tools.schemas.find(schema => schema.function.name === 'doctor');

  assert.ok(doctor);
  assert.doesNotMatch(names.join('\n'), /^web_fetch$/m);
  assert.doesNotMatch(names.join('\n'), /^mcp_list_tools$/m);
  assert.doesNotMatch(names.join('\n'), /^mcp_call_tool$/m);
  assert.equal(doctor.function.parameters.properties.mcp_health, undefined);
});

test('local-only blocks model-facing network and MCP execution paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const tools = createTools({ cwd: root, assumeYes: true, config: { localOnly: true } });

  await assert.rejects(
    () => tools.execute('web_fetch', { url: 'https://example.com' }),
    /web_fetch is disabled in local-only mode/
  );
  await assert.rejects(
    () => tools.execute('doctor', { mcp_health: true }),
    /doctor mcp_health is disabled in local-only mode/
  );
  await assert.rejects(
    () => tools.execute('mcp_list_tools', {}),
    /mcp_list_tools is disabled in local-only mode/
  );
  await assert.rejects(
    () => tools.execute('mcp_call_tool', { server: 'mock', tool: 'echo' }),
    /mcp_call_tool is disabled in local-only mode/
  );
});

test('image_info reads PNG metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO0NfXkAAAAASUVORK5CYII=',
    'base64'
  );
  await fs.writeFile(path.join(root, 'tiny.png'), png);
  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('image_info', { path: 'tiny.png' });
  assert.match(result, /mime: image\/png/);
  assert.match(result, /width: 1/);
  assert.match(result, /height: 1/);
});

test('write_file requires no prompt when assumeYes is true', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const tools = createTools({ cwd: root, assumeYes: true });
  await tools.execute('write_file', { path: 'a.txt', content: 'hello' });
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'hello');
});

test('write_file obeys workspace write policy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-policy-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      write: {
        allow: ['src/**'],
        deny: []
      }
    }
  }, null, 2)}\n`);
  const tools = createTools({ cwd: root, assumeYes: true });

  await tools.execute('write_file', { path: 'src/a.txt', content: 'hello' });
  await assert.rejects(
    () => tools.execute('write_file', { path: 'README.md', content: 'blocked' }),
    /blocked by workspace write policy/
  );
});

test('apply_patch applies a unified patch with approval bypassed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(root, 'a.txt'), 'old\n');
  const patch = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    ''
  ].join('\n');

  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('apply_patch', { patch });

  assert.match(result, /Applied patch/);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'new\n');
});

test('apply_patch obeys workspace write policy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-policy-patch-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      write: {
        allow: ['src/**'],
        deny: []
      }
    }
  }, null, 2)}\n`);
  await fs.writeFile(path.join(root, 'README.md'), 'old\n');
  const patch = [
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    ''
  ].join('\n');

  const tools = createTools({ cwd: root, assumeYes: true });
  await assert.rejects(
    () => tools.execute('apply_patch', { patch }),
    /blocked by workspace write policy/
  );
});

test('run_shell blocks obvious destructive command', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const tools = createTools({ cwd: root, assumeYes: true });
  await assert.rejects(
    () => tools.execute('run_shell', { command: 'rm -rf /' }),
    /blocked/
  );
});

test('run_shell obeys workspace command policy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-policy-shell-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), `${JSON.stringify({
    policy: {
      commands: {
        denyCommands: ['node']
      }
    }
  }, null, 2)}\n`);
  const tools = createTools({ cwd: root, assumeYes: true });

  await assert.rejects(
    () => tools.execute('run_shell', { command: 'node --version' }),
    /blocked by command safety policy/
  );
});

test('project_overview summarizes package scripts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'demo-app',
    version: '1.2.3',
    scripts: {
      dev: 'vite',
      test: 'node --test'
    },
    dependencies: {
      express: '^5.0.0'
    }
  }));

  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('project_overview', {});

  assert.match(result, /demo-app@1\.2\.3/);
  assert.match(result, /dev: vite/);
  assert.match(result, /express/);
});

test('workspace_plan tool inspects app setup without writing files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-workspace-plan-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'tool-plan-app',
    scripts: {
      dev: 'vite',
      test: 'node --test'
    },
    dependencies: {
      react: 'latest',
      vite: 'latest'
    }
  }));

  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('workspace_plan', {});

  assert.match(result, /Workspace plan/);
  assert.match(result, /launch: npm run dev \(package\)/);
  assert.match(result, /missing: profile-init, harness-init, launcher-install/);
  await assert.rejects(() => fs.stat(path.join(root, '.codepark')), /ENOENT/);

  const json = JSON.parse(await tools.execute('workspace_plan', { json: true }));
  assert.equal(json.package.name, 'tool-plan-app');
  assert.equal(json.launch.command, 'npm run dev');
});

test('workspace_boot tool initializes harness files and dashboard', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-workspace-boot-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'tool-boot-app',
    scripts: {
      dev: 'vite',
      check: 'eslint .',
      test: 'node --test'
    }
  }));
  await fs.writeFile(path.join(root, 'README.md'), '# Tool boot app\n');
  const tools = createTools({
    cwd: root,
    assumeYes: true,
    config: {
      provider: 'codex',
      baseUrl: 'codex://cli',
      model: 'codex-cli-default',
      localOnly: true,
      secureMode: true
    }
  });

  const result = await tools.execute('workspace_boot', { start: false });

  assert.match(result, /Workspace boot/);
  assert.match(result, /ok profile: wrote/);
  assert.match(result, /ok dashboard: wrote/);
  await fs.stat(path.join(root, '.codepark', 'profile.json'));
  await fs.stat(path.join(root, '.codepark', 'hooks.json'));
  await fs.stat(path.join(root, defaultLauncherName()));
  await fs.stat(path.join(root, '.codepark', 'dashboard.html'));

  const json = JSON.parse(await tools.execute('workspace_boot', { start: false, json: true }));
  assert.equal(json.ready, true);
  assert.equal(json.steps.find(step => step.name === 'profile').action, 'skipped');
});

test('profile tools initialize and read workspace profile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-profile-'));
  await fs.writeFile(path.join(root, 'Makefile'), 'verify:\n\ttrue\n');
  const tools = createTools({ cwd: root, assumeYes: true });

  const initialized = await tools.execute('init_profile', {});
  assert.match(initialized, /Wrote \.codepark\/profile\.json/);
  assert.match(initialized, /hooks: verify/);

  const read = await tools.execute('read_profile', {});
  assert.match(read, /Workspace profile/);
  assert.match(read, /hooks: verify/);
});

test('policy tools inspect and check workspace policy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-policy-read-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), `${JSON.stringify({
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
  const tools = createTools({ cwd: root, assumeYes: true });

  const read = await tools.execute('read_policy', {});
  assert.match(read, /Workspace policy/);
  assert.match(read, /write allow: src\/\*\*/);

  const writeCheck = await tools.execute('check_policy', { type: 'write', value: 'README.md' });
  assert.match(writeCheck, /blocked write: README\.md/);

  const commandCheck = JSON.parse(await tools.execute('check_policy', {
    type: 'command',
    value: 'node --version',
    json: true
  }));
  assert.equal(commandCheck.allowed, false);
  assert.equal(commandCheck.reason, 'blocked by workspace command policy');
});

test('policy preset tools list and apply presets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-policy-preset-'));
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    scripts: { verify: 'node --test' }
  }, null, 2)}\n`);
  const tools = createTools({ cwd: root, assumeYes: true });

  const list = await tools.execute('list_policy_presets', {});
  assert.match(list, /node-app/);
  assert.match(list, /strict/);

  const applied = await tools.execute('apply_policy_preset', { preset: 'python-app' });
  assert.match(applied, /preset: python-app/);
  assert.match(applied, /pyproject\.toml/);

  const forced = await tools.execute('apply_policy_preset', { preset: 'default', force: true });
  assert.match(forced, /preset: default/);
  const profile = JSON.parse(await fs.readFile(path.join(root, '.codepark', 'profile.json'), 'utf8'));
  assert.deepEqual(profile.policy.write.deny, ['.git/**', 'node_modules/**']);
});

test('container_runtime detects workspace container support', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-container-'));
  await fs.writeFile(path.join(root, 'Containerfile'), 'FROM scratch\n');
  const tools = createTools({ cwd: root, assumeYes: true });

  const result = await tools.execute('container_runtime', {});
  assert.match(result, /Container runtime/);
  assert.match(result, /files: Containerfile/);
});

test('compose tools start and stop podman compose', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-compose-'));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-compose-bin-'));
  await fs.writeFile(path.join(root, 'compose.yaml'), 'services: {}\n');
  await writeNodeExecutable(bin, 'podman', "console.log(`tool podman ${process.argv.slice(2).join(' ')}`);");
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;

  try {
    const tools = createTools({ cwd: root, assumeYes: true });
    const started = await tools.execute('compose_start', { id: 'tool-compose', detached: true });
    assert.match(started, /Compose started: tool-compose/);
    assert.match(started, /command: podman compose up -d/);

    await waitForWorker(root, 'tool-compose', worker => worker.status !== 'running' && worker.status !== 'starting' && !isPidAlive(worker.pid));
    const read = await tools.execute('read_worker', { id: 'tool-compose' });
    assert.match(read, /tool podman compose up -d/);

    const stopped = await tools.execute('compose_stop', {});
    assert.match(stopped, /Compose stopped/);
    assert.match(stopped, /tool podman compose down/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('find_files matches workspace files and ignores node_modules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.js'), '');
  await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'app.js'), '');

  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('find_files', { pattern: '**/*.js' });

  assert.match(result, /src\/app\.js/);
  assert.doesNotMatch(result, /node_modules/);
});

test('search_text returns matching file lines', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'const port = 3000;\nconsole.log(port);\n');

  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('search_text', { pattern: 'console.log' });

  assert.match(result, /src\/app\.js:2:console\.log\(port\);/);
});

test('code intelligence tools summarize and search project symbols', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.js'), [
    "import { readFile } from 'node:fs/promises';",
    'export async function runApp(config) {',
    '  return readFile(config.path, "utf8");',
    '}',
    'class Runner {}',
    ''
  ].join('\n'));
  await fs.writeFile(path.join(root, 'src', 'worker.py'), [
    'import pathlib',
    'def run_worker(path):',
    '    return pathlib.Path(path).read_text()',
    ''
  ].join('\n'));

  const tools = createTools({ cwd: root, assumeYes: true });
  const index = await tools.execute('code_index', { max_files: 20 });
  assert.match(index, /Code Index/);
  assert.match(index, /src\/app\.js/);
  assert.match(index, /function runApp/);
  assert.match(index, /class Runner/);
  assert.match(index, /src\/worker\.py/);
  assert.match(index, /function run_worker/);

  const symbols = await tools.execute('find_code_symbols', { query: 'run', max_results: 10 });
  assert.match(symbols, /runApp/);
  assert.match(symbols, /run_worker/);
});

test('run_package_script runs a package script with approval bypassed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      echo: 'node -e "console.log(42)"'
    }
  }));

  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('run_package_script', { script: 'echo' });

  assert.match(result, /42/);
});

test('mcp_list_tools lists tools from configured MCP servers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(root, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [mockMcpServer] }
    }
  }));

  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('mcp_list_tools', {});

  assert.match(result, /mock/);
  assert.match(result, /echo/);
});

test('mcp_call_tool calls a configured MCP server tool', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(root, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [mockMcpServer] }
    }
  }));

  const tools = createTools({ cwd: root, assumeYes: true });
  const result = await tools.execute('mcp_call_tool', {
    server: 'mock',
    tool: 'echo',
    arguments: { text: 'from-tool' }
  });

  assert.match(result, /echo:from-tool/);
});

test('quality_gate runs the detected verification script', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    scripts: {
      verify: 'node -e "console.log(\\"tool quality verified\\")"'
    }
  }));
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const result = await tools.execute('quality_gate', {});

  assert.match(result, /Quality gate plan: npm run verify/);
  assert.match(result, /tool quality verified/);
  assert.match(result, /Quality gate passed/);
});

test('checkpoint tools create, list, and restore workflow snapshots', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: {} }));
  await fs.writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');
  await runGit(workspace, ['init']);
  await runGit(workspace, ['config', 'user.email', 'codepark@example.test']);
  await runGit(workspace, ['config', 'user.name', 'CodePark Test']);
  await runGit(workspace, ['add', 'tracked.txt', 'package.json']);
  await runGit(workspace, ['commit', '-m', 'initial']);
  await fs.writeFile(path.join(workspace, 'tracked.txt'), 'changed\n');

  const tools = createTools({ cwd: workspace, assumeYes: true });
  const created = await tools.execute('create_checkpoint', { name: 'tool checkpoint' });
  assert.match(created, /Checkpoint created:/);
  assert.match(created, /tool checkpoint/);
  const checkpointId = created.match(/^id: (.+)$/m)?.[1];
  assert.ok(checkpointId);

  const listed = await tools.execute('list_checkpoints', {});
  assert.match(listed, /tool checkpoint/);

  await fs.writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');
  const restored = await tools.execute('restore_checkpoint', { id: checkpointId });
  assert.match(restored, /Checkpoint restored:/);
  assert.match(restored, /tool checkpoint/);
  assert.equal(await fs.readFile(path.join(workspace, 'tracked.txt'), 'utf8'), 'changed\n');
});

test('persistent shell tools preserve session state', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const started = await tools.execute('start_shell_session', { id: 'dev' });
  assert.match(started, /Shell session started: dev/);

  await tools.execute('send_shell_session', { id: 'dev', command: 'FOO=codepark' });
  const echoed = await tools.execute('send_shell_session', { id: 'dev', command: 'echo $FOO' });
  assert.match(echoed, /codepark/);

  const stopped = await tools.execute('stop_shell_session', { id: 'dev' });
  assert.match(stopped, /Shell session stopped: dev/);
});

test('task tools add, list, and complete work items', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const added = await tools.execute('add_task', { title: 'Wire task tools' });
  assert.match(added, /Task added:/);
  assert.match(added, /Wire task tools/);
  const taskId = added.match(/^id: (.+)$/m)?.[1];
  assert.ok(taskId);

  const listed = await tools.execute('list_tasks', { status: 'open' });
  assert.match(listed, /Wire task tools/);

  const completed = await tools.execute('complete_task', { id: taskId });
  assert.match(completed, /Task completed:/);

  const done = await tools.execute('list_tasks', { status: 'done' });
  assert.match(done, /Wire task tools/);

  const reopened = await tools.execute('reopen_task', { id: taskId });
  assert.match(reopened, /Task reopened:/);

  const open = await tools.execute('list_tasks', { status: 'open' });
  assert.match(open, /Wire task tools/);
});

test('task tools create, update, and filter structured metadata', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const dependency = await tools.execute('add_task', { title: 'Prepare dependency' });
  const dependencyId = dependency.match(/^id: (.+)$/m)?.[1];
  assert.ok(dependencyId);

  const added = await tools.execute('add_task', {
    title: 'Coordinate metadata',
    priority: 'high',
    depends_on: [dependencyId.slice(0, 12)],
    labels: ['agent', 'planning'],
    notes: 'Wait for dependency.'
  });
  assert.match(added, /priority: high/);
  assert.match(added, new RegExp(`dependsOn: ${dependencyId}`));
  const taskId = added.match(/^id: (.+)$/m)?.[1];
  assert.ok(taskId);

  const blocked = await tools.execute('list_tasks', { status: 'blocked' });
  assert.match(blocked, /Coordinate metadata/);
  assert.match(blocked, /priority:high/);
  assert.match(blocked, /labels:agent,planning/);

  const updated = await tools.execute('update_task', {
    id: taskId,
    priority: 'low',
    labels: ['docs'],
    notes: 'Ready for docs.'
  });
  assert.match(updated, /Task updated:/);
  assert.match(updated, /priority: low/);
  assert.match(updated, /labels: docs/);

  const updatedJson = JSON.parse(await tools.execute('update_task', {
    id: taskId,
    priority: 'low',
    labels: ['docs'],
    notes: 'Ready for docs.',
    json: true
  }));
  assert.equal(updatedJson.version, 1);
  assert.equal(updatedJson.id, taskId);
  assert.equal(updatedJson.title, 'Coordinate metadata');
  assert.equal(updatedJson.priority, 'low');
  assert.deepEqual(updatedJson.labels, ['docs']);
  assert.equal(updatedJson.notes, 'Ready for docs.');

  const filtered = await tools.execute('list_tasks', { status: 'open', label: 'docs', priority: 'low' });
  assert.match(filtered, /Coordinate metadata/);
  assert.doesNotMatch(filtered, /Prepare dependency/);

  const filteredJson = JSON.parse(await tools.execute('list_tasks', { status: 'open', label: 'docs', priority: 'low', json: true }));
  assert.equal(filteredJson.version, 1);
  assert.equal(filteredJson.tasks.length, 1);
  assert.equal(filteredJson.tasks[0].id, taskId);
  assert.equal(filteredJson.tasks[0].title, 'Coordinate metadata');
  assert.deepEqual(filteredJson.tasks[0].labels, ['docs']);

  const detail = await tools.execute('show_task', { id: taskId });
  assert.match(detail, /Task detail:/);
  assert.match(detail, /notes: Ready for docs\./);
  assert.match(detail, /labels: docs/);

  const detailJson = JSON.parse(await tools.execute('show_task', { id: taskId, json: true }));
  assert.equal(detailJson.version, 1);
  assert.equal(detailJson.id, taskId);
  assert.equal(detailJson.title, 'Coordinate metadata');
  assert.equal(detailJson.priority, 'low');
  assert.deepEqual(detailJson.labels, ['docs']);
  assert.equal(detailJson.notes, 'Ready for docs.');

  const completedJson = JSON.parse(await tools.execute('complete_task', { id: taskId, json: true }));
  assert.equal(completedJson.version, 1);
  assert.equal(completedJson.id, taskId);
  assert.equal(completedJson.status, 'done');

  const reopenedJson = JSON.parse(await tools.execute('reopen_task', { id: taskId, json: true }));
  assert.equal(reopenedJson.version, 1);
  assert.equal(reopenedJson.id, taskId);
  assert.equal(reopenedJson.status, 'open');
});

test('worker tools run task-scoped background commands', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const tools = createTools({ cwd: workspace, assumeYes: true });
  const added = await tools.execute('add_task', { title: 'Run worker tool' });
  const taskId = added.match(/^id: (.+)$/m)?.[1];
  assert.ok(taskId);
  const command = `${JSON.stringify(process.execPath)} -e "console.log('tool line one'); console.log('tool worker done')"`;

  const started = await tools.execute('start_worker', { task_id: taskId, command, id: 'tool-worker' });
  assert.match(started, /Worker started: tool-worker/);

  await waitForWorker(workspace, 'tool-worker', worker => worker.status !== 'running');
  const read = await tools.execute('read_worker', { id: 'tool-worker' });
  assert.match(read, /tool worker done/);
  const tailed = await tools.execute('read_worker', { id: 'tool-worker', tail_lines: 1 });
  assert.doesNotMatch(tailed, /tool line one/);
  assert.match(tailed, /tool worker done/);
  const readJson = JSON.parse(await tools.execute('read_worker', { id: 'tool-worker', json: true }));
  assert.equal(readJson.version, 1);
  assert.equal(readJson.id, 'tool-worker');
  assert.equal(readJson.status, 'done');
  assert.equal(readJson.truncated, false);
  assert.match(readJson.output, /tool worker done/);
  const listed = await tools.execute('list_workers', { task_id: taskId });
  assert.match(listed, /tool-worker/);
  const listedJson = JSON.parse(await tools.execute('list_workers', { json: true }));
  assert.equal(listedJson.version, 1);
  assert.equal(listedJson.workers[0].id, 'tool-worker');

  const pruned = await tools.execute('prune_workers', {});
  assert.match(pruned, /removed: 1/);
  assert.equal(await tools.execute('list_workers', {}), 'No workers.');
});

test('start_app tool creates a managed app worker', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-app-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'node -e "console.log(\\"tool app started\\")"'
    }
  }));
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const started = await tools.execute('start_app', { id: 'tool-app' });
  assert.match(started, /App started: tool-app/);
  assert.match(started, /command: npm run dev/);

  await waitForWorker(workspace, 'tool-app', worker => worker.status !== 'running');
  const read = await tools.execute('read_worker', { id: 'tool-app' });
  assert.match(read, /tool app started/);
});

test('worker prune tool can remove only failed workers', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-prune-failed-'));
  await writeWorkerRecords(workspace, [
    { id: 'worker-failed', status: 'failed', exitCode: 1 },
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const pruned = await tools.execute('prune_workers', { failed_only: true });

  assert.match(pruned, /removed: 1/);
  const workers = await listWorkers(workspace);
  assert.deepEqual(workers.map(worker => worker.id), ['worker-done']);
  await assert.rejects(() => fs.stat(path.join(workspace, '.codepark', 'workers', 'worker-failed.log')), /ENOENT/);
  await fs.stat(path.join(workspace, '.codepark', 'workers', 'worker-done.log'));
});

test('worker prune tool can return structured JSON metadata', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-prune-json-'));
  await writeWorkerRecords(workspace, [
    { id: 'worker-failed', status: 'failed', exitCode: 1 },
    { id: 'worker-done', status: 'done', exitCode: 0 }
  ]);
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const pruned = JSON.parse(await tools.execute('prune_workers', { failed_only: true, json: true }));

  assert.equal(pruned.version, 1);
  assert.deepEqual(pruned.removed.map(worker => worker.id), ['worker-failed']);
  assert.deepEqual(pruned.kept.map(worker => worker.id), ['worker-done']);
  const workers = await listWorkers(workspace);
  assert.deepEqual(workers.map(worker => worker.id), ['worker-done']);
});

test('agent worker tool starts a codex background agent', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const mockCodex = await writeMockExecutable(workspace, [
    '#!/usr/bin/env node',
    "console.log('tool mock codex invoked')",
    "console.log(JSON.stringify({ type: 'session_configured', thread_id: 'tool-thread' }))",
    "console.log(process.argv.slice(2).join('\\n'))"
  ]);
  const previousCodexCommand = process.env.CODEPARK_CODEX_COMMAND;
  process.env.CODEPARK_CODEX_COMMAND = mockCodex;
  try {
    const tools = createTools({ cwd: workspace, assumeYes: true });
    const added = await tools.execute('add_task', { title: 'Run agent worker tool' });
    const taskId = added.match(/^id: (.+)$/m)?.[1];
    assert.ok(taskId);

    const started = await tools.execute('start_agent_worker', {
      task_id: taskId,
      prompt: 'Check parity with reference agents.',
      id: 'tool-agent'
    });
    assert.match(started, /Agent started: tool-agent/);

    await waitForWorkerOutput(workspace, 'tool-agent', /tool mock codex invoked/);
    await waitForWorker(workspace, 'tool-agent', worker => worker.status === 'running');
    const read = await tools.execute('read_worker', { id: 'tool-agent' });
    assert.match(read, /tool mock codex invoked/);
    assert.match(read, /Check parity with reference agents/);
    await stopWorker(workspace, 'tool-agent');
  } finally {
    if (previousCodexCommand === undefined) delete process.env.CODEPARK_CODEX_COMMAND;
    else process.env.CODEPARK_CODEX_COMMAND = previousCodexCommand;
  }
});

test('agent message tool sends follow-up text to a running codex background agent', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const mockCodex = await writeMockExecutable(workspace, [
    '#!/usr/bin/env node',
    "const args = process.argv.slice(2)",
    "console.log(JSON.stringify({ type: 'session_configured', thread_id: 'tool-thread' }))",
    "if (args[0] === 'exec' && args[1] === 'resume') console.log('tool mock resume turn')",
    "else console.log('tool mock initial turn')",
    "console.log(args.join('\\n'))"
  ]);
  const previousCodexCommand = process.env.CODEPARK_CODEX_COMMAND;
  process.env.CODEPARK_CODEX_COMMAND = mockCodex;
  try {
    const tools = createTools({ cwd: workspace, assumeYes: true });
    const added = await tools.execute('add_task', { title: 'Send agent worker message' });
    const taskId = added.match(/^id: (.+)$/m)?.[1];
    assert.ok(taskId);

    await tools.execute('start_agent_worker', {
      task_id: taskId,
      prompt: 'Wait for tool follow-up.',
      id: 'tool-agent-send'
    });
    const sent = await tools.execute('send_agent_message', {
      id: 'tool-agent-send',
      message: 'continue tool agent'
    });
    assert.match(sent, /Agent message sent: tool-agent-send/);

    await waitForWorkerOutput(workspace, 'tool-agent-send', /tool mock resume turn/);
    const read = await tools.execute('read_worker', { id: 'tool-agent-send' });
    assert.match(read, /tool mock initial turn/);
    assert.match(read, /tool mock resume turn/);
    assert.match(read, /continue tool agent/);
    await stopWorker(workspace, 'tool-agent-send');
  } finally {
    if (previousCodexCommand === undefined) delete process.env.CODEPARK_CODEX_COMMAND;
    else process.env.CODEPARK_CODEX_COMMAND = previousCodexCommand;
  }
});

test('agent dashboard tool summarizes tasks, agents, inbox, and logs', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  const mockCodex = await writeMockExecutable(workspace, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2)',
    "console.log(JSON.stringify({ type: 'session_configured', thread_id: 'tool-dashboard-thread' }))",
    "if (args[0] === 'exec' && args[1] === 'resume') console.log('tool dashboard resume')",
    "else console.log('tool dashboard initial')",
    "console.log(args.join('\\n'))"
  ]);
  const previousCodexCommand = process.env.CODEPARK_CODEX_COMMAND;
  process.env.CODEPARK_CODEX_COMMAND = mockCodex;
  try {
    const tools = createTools({ cwd: workspace, assumeYes: true });
    const added = await tools.execute('add_task', { title: 'Tool dashboard task' });
    const taskId = added.match(/^id: (.+)$/m)?.[1];
    assert.ok(taskId);

    await tools.execute('start_agent_worker', {
      task_id: taskId,
      prompt: 'Prepare tool dashboard state.',
      id: 'tool-dashboard-agent'
    });
    await waitForWorkerOutput(workspace, 'tool-dashboard-agent', /tool dashboard initial/);
    await tools.execute('send_agent_message', {
      id: 'tool-dashboard-agent',
      message: 'tool dashboard follow-up'
    });
    await waitForWorkerOutput(workspace, 'tool-dashboard-agent', /tool dashboard resume/);

    const dashboard = await tools.execute('agent_dashboard', {});
    assert.match(dashboard, /Agent Dashboard/);
    assert.match(dashboard, /Tool dashboard task/);
    assert.match(dashboard, /tool-dashboard-agent/);
    assert.match(dashboard, /running/);
    assert.match(dashboard, /tool-dashboard-thread/);
    assert.match(dashboard, /last message: tool dashboard follow-up/);
    assert.match(dashboard, /tool dashboard resume/);

    await stopWorker(workspace, 'tool-dashboard-agent');
  } finally {
    if (previousCodexCommand === undefined) delete process.env.CODEPARK_CODEX_COMMAND;
    else process.env.CODEPARK_CODEX_COMMAND = previousCodexCommand;
  }
});

test('agent dashboard tool can return structured JSON', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-dashboard-json-'));
  const tools = createTools({ cwd: workspace, assumeYes: true });
  const added = await tools.execute('add_task', {
    title: 'Tool dashboard JSON task',
    priority: 'low',
    labels: ['json']
  });
  const taskId = added.match(/^id: (.+)$/m)?.[1];
  assert.ok(taskId);

  const dashboard = JSON.parse(await tools.execute('agent_dashboard', { json: true }));
  assert.equal(dashboard.version, 1);
  assert.equal(dashboard.cwd, workspace);
  assert.equal(dashboard.totals.tasks, 1);
  assert.equal(dashboard.totals.agents, 0);
  assert.equal(dashboard.tasks[0].id, taskId);
  assert.equal(dashboard.tasks[0].title, 'Tool dashboard JSON task');
  assert.equal(dashboard.tasks[0].priority, 'low');
  assert.deepEqual(dashboard.tasks[0].labels, ['json']);
  assert.deepEqual(dashboard.tasks[0].agents, []);
  assert.deepEqual(dashboard.tasks[0].shellWorkers, []);
});

test('agent dashboard html tool writes a static browser dashboard', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-dashboard-html-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'tool-browser-dashboard-fixture',
    version: '1.0.0',
    bin: { codepark: 'bin/codepark.js' }
  }));
  await fs.writeFile(path.join(workspace, 'README.md'), '# Tool browser dashboard fixture\n');
  const tools = createTools({
    cwd: workspace,
    assumeYes: true,
    config: {
      provider: 'codex',
      baseUrl: 'codex://cli',
      model: 'codex-cli-default',
      localOnly: true,
      secureMode: true
    }
  });
  const added = await tools.execute('add_task', {
    title: 'Tool browser dashboard task',
    labels: ['html']
  });
  const taskId = added.match(/^id: (.+)$/m)?.[1];
  assert.ok(taskId);

  const result = await tools.execute('agent_dashboard_html', { task_id: taskId });

  assert.match(result, /Wrote \.codepark\/dashboard\.html/);
  const html = await fs.readFile(path.join(workspace, '.codepark', 'dashboard.html'), 'utf8');
  assert.match(html, /CodePark Dashboard/);
  assert.match(html, /Tool browser dashboard task/);
  assert.match(html, /Workspace Policy/);
});

test('hook tools list and run configured hooks', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.mkdir(path.join(workspace, '.codepark'));
  await fs.writeFile(path.join(workspace, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: {
      verify: ['node -e "console.log(\\"tool hook verified\\")"']
    }
  }));
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const listed = await tools.execute('list_hooks', {});
  assert.match(listed, /verify/);

  const ran = await tools.execute('run_hook', { name: 'verify' });
  assert.match(ran, /Hook passed: verify/);
  assert.match(ran, /tool hook verified/);
});

test('init_harness tool writes inferred project hooks', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-harness-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    scripts: {
      verify: 'node verify.js',
      build: 'node build.js'
    }
  }));
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const result = await tools.execute('init_harness', {});
  assert.match(result, /Wrote \.codepark\/hooks\.json/);
  assert.match(result, /verify \| npm run verify/);
  assert.match(result, /build \| npm run build/);

  const listed = await tools.execute('list_hooks', {});
  assert.match(listed, /verify/);
  assert.match(listed, /build/);
});

test('install_launcher tool writes a clickable launcher', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-launcher-'));
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const result = await tools.execute('install_launcher', { target: 'OpenCodePark.command' });
  assert.match(result, /Wrote OpenCodePark\.command/);

  const text = await fs.readFile(path.join(workspace, 'OpenCodePark.command'), 'utf8');
  assert.match(text, process.platform === 'win32' ? /where codepark/ : /command -v codepark/);
  assert.match(text, /--secure/);
  assert.match(text, /workspace-boot/);
  assert.match(text, process.platform === 'win32' ? /bin\\codepark\.js/ : /bin\/codepark\.js/);
});

async function writeMockExecutable(directory, lines) {
  const file = await writeNodeScript(
    directory,
    `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    lines.join('\n')
  );
  return nodeCommand(file);
}

test('local skill tools list and read workspace skills', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const listed = await tools.execute('list_skills', { query: 'review' });
  assert.match(listed, /review/);

  const skill = await tools.execute('read_skill', { id: 'review' });
  assert.match(skill, /Local skill: review/);
  assert.match(skill, /Check risks/);
});

test('skill package tools pack and install workspace skills', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');
  const tools = createTools({ cwd: workspace, assumeYes: true });

  const packed = await tools.execute('pack_skill', {
    id: 'review',
    output_path: 'review.skill.json'
  });
  assert.match(packed, /Skill package written/);

  const installed = await tools.execute('install_skill_package', {
    package_path: 'review.skill.json',
    skill_id: 'shared-review'
  });
  assert.match(installed, /Skill package installed/);

  const skill = await tools.execute('read_skill', { id: 'shared-review' });
  assert.match(skill, /Local skill: shared-review/);
  assert.match(skill, /Check risks/);
});

test('doctor tool reports workflow diagnostics', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { verify: ['npm run verify'] }
  }));
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n');
  const tools = createTools({
    cwd: workspace,
    assumeYes: true,
    config: { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }
  });

  const result = await tools.execute('doctor', {});

  assert.match(result, /ok provider: codex/);
  assert.match(result, /ok hooks: 1 hook configured/);
  assert.match(result, /ok skills: 1 local skill/);
  assert.match(result, /ok tasks: no task ledger/);
});

test('doctor tool can return structured JSON', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-doctor-json-'));
  await fs.mkdir(path.join(workspace, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { verify: ['npm run verify'] }
  }));
  await fs.writeFile(path.join(workspace, '.codepark', 'skills', 'review.md'), '# Review\n');
  const tools = createTools({
    cwd: workspace,
    assumeYes: true,
    config: { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }
  });

  const report = JSON.parse(await tools.execute('doctor', { json: true }));
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

test('readiness tool reports endpoint and secure-harness posture', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-readiness-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'readiness-target',
    version: '0.0.1',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' }
  }));
  await fs.writeFile(path.join(workspace, 'README.md'), 'Private local project for personal use only.\n');
  const tools = createTools({
    cwd: workspace,
    assumeYes: true,
    config: { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }
  });

  const text = await tools.execute('readiness', {});
  assert.match(text, /CodePark readiness/);
  assert.match(text, /mode: codex-cli/);
  assert.match(text, /Secure harness: not ready/);

  const json = JSON.parse(await tools.execute('readiness', { json: true }));
  assert.equal(json.version, 1);
  assert.equal(json.endpoint.mode, 'codex-cli');
  assert.equal(json.secureHarness.ready, false);
});

test('project assessment tool reports readiness gaps', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-assessment-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'assessment-target',
    version: '0.0.1',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' },
    scripts: { test: 'node --test' }
  }));
  await fs.writeFile(path.join(workspace, 'README.md'), 'Private local project for personal use only.\n');
  const tools = createTools({
    cwd: workspace,
    assumeYes: true,
    config: { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }
  });

  const text = await tools.execute('project_assessment', {});
  assert.match(text, /CodePark assessment/);
  assert.match(text, /secure harness: not ready/);

  const json = JSON.parse(await tools.execute('project_assessment', { json: true }));
  assert.equal(json.version, 1);
  assert.equal(json.package.name, 'assessment-target');
  assert.equal(json.summary.secureHarnessReady, false);
  assert.ok(json.gaps.some(gap => gap.includes('workspace: missing profile-init')));
});

test('assessment task tool creates local task items with approval', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-assessment-tasks-'));
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'assessment-task-target',
    version: '0.0.1',
    private: true,
    license: 'UNLICENSED',
    bin: { codepark: './bin/codepark.js' },
    scripts: { test: 'node --test' }
  }));
  await fs.writeFile(path.join(workspace, 'README.md'), 'Private local project for personal use only.\n');
  const tools = createTools({
    cwd: workspace,
    assumeYes: true,
    config: { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }
  });

  const result = JSON.parse(await tools.execute('create_assessment_tasks', { json: true }));

  assert.equal(result.version, 1);
  assert.ok(result.added.length > 0);
  assert.ok(result.added.every(task => task.labels.includes('assessment')));
});

test('doctor tool can probe configured MCP server health', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-tools-'));
  await fs.writeFile(path.join(workspace, '.codepark.mcp.json'), JSON.stringify({
    servers: {
      mock: { command: process.execPath, args: [mockMcpServer] }
    }
  }));
  const tools = createTools({
    cwd: workspace,
    assumeYes: true,
    config: { provider: 'codex', baseUrl: 'codex://cli', model: 'codex-cli-default' }
  });

  const result = await tools.execute('doctor', { mcp_health: true });

  assert.match(result, /ok mcp: MCP health ok: mock: 1 tool/);
});

async function runGit(cwd, args) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)('git', args, { cwd });
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

async function waitForWorker(cwd, id, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const worker = (await listWorkers(cwd)).find(worker => worker.id === id);
    if (worker && predicate(worker)) return worker;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`worker did not reach expected state: ${id}`);
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

async function waitForWorkerOutput(cwd, id, pattern) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const worker = await readWorker(cwd, id).catch(() => null);
    if (worker && pattern.test(worker.output)) return worker;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`worker output did not match ${pattern}: ${id}`);
}
