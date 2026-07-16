import { addTask } from './tasks.js';
import { startWorker } from './workers.js';
import { detectPackageManager, readPackageJson } from './project.js';
import { formatPackageScriptCommand } from './qualityGate.js';
import { detectContainerRuntime } from './containerRuntime.js';
import { readWorkspaceProfile } from './workspaceProfile.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const appScriptOrder = ['dev', 'start', 'serve', 'preview'];
const makeAppTargets = ['dev', 'start', 'serve', 'run'];
const composerAppScripts = ['dev', 'start', 'serve'];
const rakeAppTargets = ['dev', 'start', 'serve', 'server'];

export async function startApp(cwd, options = {}) {
  const launch = await detectAppLaunch(cwd, options);
  if (!launch.command) throw new Error(launch.message);
  return startAppCommand(cwd, {
    packageManager: launch.packageManager,
    script: launch.script,
    command: launch.command,
    id: options.id
  });
}

export async function detectAppLaunch(cwd, options = {}) {
  const profile = await readWorkspaceProfile(cwd);
  const profiledCommand = String(options.command ?? profile?.app?.command ?? '').trim();
  if (profiledCommand) {
    return {
      source: 'profile',
      script: 'profile.command',
      command: profiledCommand,
      packageManager: '',
      message: 'profile app command configured'
    };
  }

  const requestedScript = options.script ?? profile?.app?.script;
  const packageJson = await readPackageJson(cwd);
  if (packageJson) {
    const scripts = packageJson.scripts ?? {};
    const script = selectAppScript(scripts, requestedScript);
    if (script) {
      const packageManager = await detectPackageManager(cwd);
      return {
        source: 'package',
        packageManager,
        script,
        command: formatPackageScriptCommand(packageManager, script),
        message: `package script ${script}`
      };
    }
  }

  const makeTarget = await selectMakeAppTarget(cwd, requestedScript);
  if (makeTarget) {
    return {
      source: 'make',
      script: makeTarget,
      command: `make ${makeTarget}`,
      packageManager: '',
      message: `Makefile target ${makeTarget}`
    };
  }

  const javaLaunch = await detectJavaAppLaunch(cwd, requestedScript);
  if (javaLaunch) return javaLaunch;

  const phpLaunch = await detectPhpAppLaunch(cwd, requestedScript);
  if (phpLaunch) return phpLaunch;

  const rubyLaunch = await detectRubyAppLaunch(cwd, requestedScript);
  if (rubyLaunch) return rubyLaunch;

  const container = await detectContainerRuntime(cwd);
  if (!requestedScript && container.composeCommand && hasComposeFile(container)) {
    return {
      source: 'compose',
      script: 'compose',
      command: `${container.composeCommand} up`,
      packageManager: '',
      message: 'Compose file detected'
    };
  }

  return {
    source: '',
    script: '',
    command: '',
    packageManager: '',
    message: `No app launch command found. Add package script ${appScriptOrder.join('/')}, Makefile target ${makeAppTargets.join('/')}, Java/PHP/Ruby app entrypoint, Compose file, or .codepark/profile.json app.command.`
  };
}

export function selectAppScript(scripts = {}, requested) {
  const explicit = String(requested ?? '').trim();
  if (explicit) {
    if (!/^[\w:-]+$/.test(explicit)) throw new Error('app script name must be simple');
    if (!scripts[explicit]) return '';
    return explicit;
  }
  return appScriptOrder.find(script => scripts[script]) || '';
}

export function formatAppStart(result) {
  return [
    `App started: ${result.worker.id}`,
    `task: ${result.task.id}`,
    `script: ${result.script}`,
    `command: ${result.command}`,
    `log: ${result.worker.logPath}`,
    '',
    `Next: use /worker-read ${result.worker.id} --tail 80, /workers, or /worker-stop ${result.worker.id}.`
  ].join('\n');
}

async function startAppCommand(cwd, options) {
  const command = String(options.command ?? '').trim();
  if (!command) throw new Error('app command is required');
  const script = String(options.script ?? 'app').trim();
  const task = await addTask(cwd, {
    title: `Run app script: ${script}`,
    labels: ['app', 'runtime'],
    notes: `Managed by CodePark app-start.\ncommand: ${command}`
  });
  const worker = await startWorker(cwd, {
    taskId: task.id,
    command,
    id: options.id
  });

  return {
    packageManager: options.packageManager ?? '',
    script,
    command,
    task,
    worker
  };
}

async function selectMakeAppTarget(cwd, requested) {
  const targets = await readMakeTargets(cwd);
  const explicit = String(requested ?? '').trim();
  if (explicit) {
    if (!/^[\w:-]+$/.test(explicit)) throw new Error('app script name must be simple');
    return targets.has(explicit) ? explicit : '';
  }
  return makeAppTargets.find(target => targets.has(target)) || '';
}

async function detectJavaAppLaunch(cwd, requested) {
  const explicit = String(requested ?? '').trim();
  const gradleFile = await readFirstExisting(cwd, ['build.gradle', 'build.gradle.kts']);
  if (gradleFile) {
    const gradle = await exists(path.join(cwd, 'gradlew')) ? './gradlew' : 'gradle';
    const command = selectGradleAppCommand(gradleFile.text, gradle, explicit);
    if (command) {
      return {
        source: 'java',
        script: command.script,
        command: command.command,
        packageManager: 'gradle',
        message: `Gradle ${command.script}`
      };
    }
  }

  const pom = await readOptionalText(path.join(cwd, 'pom.xml'));
  if (pom && (!explicit || explicit === 'spring-boot:run')) {
    if (/spring-boot-(?:starter|maven-plugin)/.test(pom)) {
      return {
        source: 'java',
        script: 'spring-boot:run',
        command: 'mvn spring-boot:run',
        packageManager: 'maven',
        message: 'Maven Spring Boot app'
      };
    }
  }
  return null;
}

async function detectPhpAppLaunch(cwd, requested) {
  const composer = await readJsonFile(path.join(cwd, 'composer.json'));
  const scripts = composer?.scripts && typeof composer.scripts === 'object' ? composer.scripts : {};
  const script = selectNamedItem(scripts, composerAppScripts, requested);
  if (script) {
    return {
      source: 'php',
      script,
      command: `composer run ${script}`,
      packageManager: 'composer',
      message: `Composer script ${script}`
    };
  }
  if (requested) return null;
  const publicIndex = await exists(path.join(cwd, 'public', 'index.php'));
  const rootIndex = await exists(path.join(cwd, 'index.php'));
  if (publicIndex || rootIndex) {
    const docroot = publicIndex ? 'public' : '.';
    return {
      source: 'php',
      script: 'php-server',
      command: `php -S 127.0.0.1:8000 -t ${docroot}`,
      packageManager: '',
      message: `PHP built-in server (${docroot})`
    };
  }
  return null;
}

async function detectRubyAppLaunch(cwd, requested) {
  const rakeTargets = await readRakeTargets(cwd);
  const rakeTarget = selectNamedItem(Object.fromEntries([...rakeTargets].map(target => [target, true])), rakeAppTargets, requested);
  if (rakeTarget) {
    return {
      source: 'ruby',
      script: rakeTarget,
      command: `${await exists(path.join(cwd, 'Gemfile')) ? 'bundle exec ' : ''}rake ${rakeTarget}`,
      packageManager: 'rake',
      message: `Rake target ${rakeTarget}`
    };
  }
  if (requested) return null;
  if (await exists(path.join(cwd, 'bin', 'rails')) || await exists(path.join(cwd, 'config', 'application.rb'))) {
    return {
      source: 'ruby',
      script: 'rails-server',
      command: `${await exists(path.join(cwd, 'Gemfile')) ? 'bundle exec ' : ''}rails server -b 127.0.0.1`,
      packageManager: 'rails',
      message: 'Rails server'
    };
  }
  if (await exists(path.join(cwd, 'config.ru'))) {
    return {
      source: 'ruby',
      script: 'rackup',
      command: `${await exists(path.join(cwd, 'Gemfile')) ? 'bundle exec ' : ''}rackup -o 127.0.0.1`,
      packageManager: 'rack',
      message: 'Rack app'
    };
  }
  return null;
}

function selectGradleAppCommand(text, gradle, explicit) {
  const appTasks = ['bootRun', 'run'];
  if (explicit) {
    if (!/^[\w:-]+$/.test(explicit)) throw new Error('app script name must be simple');
    if (appTasks.includes(explicit)) return { script: explicit, command: `${gradle} ${explicit}` };
    return null;
  }
  if (/org\.springframework\.boot|spring-boot/.test(text)) return { script: 'bootRun', command: `${gradle} bootRun` };
  if (/\bapplication\b|id\s*\(?['"]application['"]/.test(text)) return { script: 'run', command: `${gradle} run` };
  return null;
}

function selectNamedItem(items, order, requested) {
  const explicit = String(requested ?? '').trim();
  if (explicit) {
    if (!/^[\w:-]+$/.test(explicit)) throw new Error('app script name must be simple');
    return items[explicit] ? explicit : '';
  }
  return order.find(name => items[name]) || '';
}

async function readMakeTargets(cwd) {
  const text = await fs.readFile(path.join(cwd, 'Makefile'), 'utf8').catch(error => {
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

async function readRakeTargets(cwd) {
  const text = await readOptionalText(path.join(cwd, 'Rakefile'));
  const targets = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:task\s+[:'"]([A-Za-z0-9_.:-]+)|([A-Za-z0-9_.:-]+)\s*:)/);
    const target = match?.[1] || match?.[2];
    if (target) targets.add(target);
  }
  return targets;
}

async function readFirstExisting(cwd, files) {
  for (const file of files) {
    const absolute = path.join(cwd, file);
    const text = await readOptionalText(absolute);
    if (text) return { file, text };
  }
  return null;
}

async function readOptionalText(file) {
  return fs.readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
}

async function readJsonFile(file) {
  const text = await readOptionalText(file);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hasComposeFile(container) {
  return container.files.some(file => file === 'compose.yaml'
    || file === 'compose.yml'
    || file === 'docker-compose.yaml'
    || file === 'docker-compose.yml');
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
