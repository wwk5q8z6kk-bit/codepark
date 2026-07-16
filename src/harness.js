import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './atomicWrite.js';
import { detectPackageManager, readPackageJson } from './project.js';
import { formatPackageScriptCommand, selectQualityGateScripts } from './qualityGate.js';

const hooksPath = path.join('.codepark', 'hooks.json');
const auxiliaryScriptHooks = ['build', 'smoke', 'smoke:all'];
const makeHookTargets = ['verify', 'check', 'lint', 'typecheck', 'test', 'build', 'smoke'];

export async function initHarness(cwd, options = {}) {
  const inferred = await inferWorkspaceHooks(cwd);
  const hooks = inferred.hooks;
  if (!Object.keys(hooks).length) {
    throw new Error('No hookable project commands found. Add package scripts, Makefile targets, go.mod, Cargo.toml, Python, Java, PHP, or Ruby project files.');
  }

  const file = path.join(cwd, hooksPath);
  const config = { hooks };
  await fs.mkdir(path.dirname(file), { recursive: true });

  let overwritten = false;
  if (options.force) {
    overwritten = await exists(file);
    await writeJsonAtomic(file, config);
  } else {
    await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' }).catch(error => {
      if (error?.code === 'EEXIST') {
        throw new Error(`${hooksPath} already exists. Re-run with --force to replace it.`);
      }
      throw error;
    });
  }

  return {
    path: hooksPath,
    adapters: inferred.adapters,
    packageManager: inferred.packageManager,
    hooks: Object.entries(hooks).map(([name, commands]) => ({ name, commands })),
    overwritten
  };
}

export async function inferWorkspaceHooks(cwd) {
  const adapters = [];
  const hooks = {};
  const packageJson = await readPackageJson(cwd);
  let packageManager = '';

  if (packageJson) {
    packageManager = await detectPackageManager(cwd);
    mergeHooks(hooks, inferHarnessHooks(packageJson.scripts ?? {}, packageManager));
    if (Object.keys(hooks).length) adapters.push('node');
  }

  const makeTargets = await readMakeTargets(cwd);
  if (makeTargets.size) {
    mergeHooks(hooks, inferMakeHooks(makeTargets));
    adapters.push('make');
  }

  if (await exists(path.join(cwd, 'go.mod'))) {
    mergeHooks(hooks, {
      verify: ['go test ./...'],
      build: ['go build ./...']
    });
    adapters.push('go');
  }

  if (await exists(path.join(cwd, 'Cargo.toml'))) {
    mergeHooks(hooks, {
      verify: ['cargo test'],
      build: ['cargo build']
    });
    adapters.push('rust');
  }

  if (await hasPythonProject(cwd)) {
    mergeHooks(hooks, inferPythonHooks(cwd));
    adapters.push('python');
  }

  const javaHooks = await inferJavaHooks(cwd);
  if (Object.keys(javaHooks).length) {
    mergeHooks(hooks, javaHooks);
    adapters.push('java');
  }

  const phpHooks = await inferPhpHooks(cwd);
  if (Object.keys(phpHooks).length) {
    mergeHooks(hooks, phpHooks);
    adapters.push('php');
  }

  const rubyHooks = await inferRubyHooks(cwd);
  if (Object.keys(rubyHooks).length) {
    mergeHooks(hooks, rubyHooks);
    adapters.push('ruby');
  }

  return {
    adapters: unique(adapters),
    packageManager,
    hooks
  };
}

export function inferHarnessHooks(scripts = {}, packageManager = 'npm') {
  const hooks = {};
  const qualityScripts = selectQualityGateScripts(scripts);
  if (qualityScripts.length) {
    hooks.verify = qualityScripts.map(script => formatPackageScriptCommand(packageManager, script));
  }

  for (const script of auxiliaryScriptHooks) {
    if (scripts[script] && !hooks[script]) {
      hooks[script] = [formatPackageScriptCommand(packageManager, script)];
    }
  }

  return hooks;
}

export function formatHarnessInit(result) {
  const lines = [
    `${result.overwritten ? 'Rewrote' : 'Wrote'} ${result.path}`,
    `adapters: ${result.adapters?.length ? result.adapters.join(', ') : 'none'}`,
    ...(result.packageManager ? [`packageManager: ${result.packageManager}`] : []),
    'hooks:'
  ];
  for (const hook of result.hooks) {
    lines.push(`  ${hook.name} | ${hook.commands.join(' && ')}`);
  }
  lines.push('', 'Next: run /hooks, /hook verify, or /quality-gate inside CodePark.');
  return lines.join('\n');
}

function inferMakeHooks(targets) {
  const hooks = {};
  for (const target of makeHookTargets) {
    if (targets.has(target)) hooks[target] = [`make ${target}`];
  }
  return hooks;
}

function inferPythonHooks(cwd) {
  const hooks = {};
  hooks.verify = ['python -m compileall -q .'];
  return hooks;
}

async function inferJavaHooks(cwd) {
  const hooks = {};
  if (await exists(path.join(cwd, 'build.gradle')) || await exists(path.join(cwd, 'build.gradle.kts')) || await exists(path.join(cwd, 'gradlew'))) {
    const gradle = await exists(path.join(cwd, 'gradlew')) ? './gradlew' : 'gradle';
    hooks.verify = [`${gradle} test`];
    hooks.build = [`${gradle} build`];
    return hooks;
  }
  if (await exists(path.join(cwd, 'pom.xml'))) {
    hooks.verify = ['mvn test'];
    hooks.build = ['mvn package -DskipTests'];
  }
  return hooks;
}

async function inferPhpHooks(cwd) {
  const composer = await readComposerJson(cwd);
  const scripts = composer?.scripts && typeof composer.scripts === 'object' ? composer.scripts : {};
  const hooks = {};
  const verifyScripts = ['check', 'lint', 'test'].filter(name => scripts[name]);
  if (verifyScripts.length) hooks.verify = verifyScripts.map(name => `composer run ${name}`);
  if (scripts.build) hooks.build = ['composer run build'];
  if (!hooks.verify && (await exists(path.join(cwd, 'phpunit.xml')) || await exists(path.join(cwd, 'phpunit.xml.dist')))) {
    hooks.verify = ['vendor/bin/phpunit'];
  }
  return hooks;
}

async function inferRubyHooks(cwd) {
  const hooks = {};
  const hasGemfile = await exists(path.join(cwd, 'Gemfile'));
  const hasRakefile = await exists(path.join(cwd, 'Rakefile'));
  if (hasGemfile && hasRakefile) hooks.verify = ['bundle exec rake test'];
  else if (hasRakefile) hooks.verify = ['rake test'];
  return hooks;
}

async function readComposerJson(cwd) {
  const text = await fs.readFile(path.join(cwd, 'composer.json'), 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readMakeTargets(cwd) {
  const file = path.join(cwd, 'Makefile');
  const text = await fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  const targets = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_.:-]+)\s*:(?![=])/);
    if (match) targets.add(match[1]);
  }
  return targets;
}

async function hasPythonProject(cwd) {
  const files = ['pyproject.toml', 'setup.py', 'requirements.txt', 'pytest.ini'];
  for (const file of files) {
    if (await exists(path.join(cwd, file))) return true;
  }
  return await exists(path.join(cwd, 'tests'));
}

function mergeHooks(target, source) {
  for (const [name, commands] of Object.entries(source)) {
    if (!target[name]) target[name] = commands;
  }
}

function unique(items) {
  return [...new Set(items)];
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
