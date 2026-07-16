import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectAppLaunch, selectAppScript, startApp } from '../src/appLauncher.js';
import { readWorker } from '../src/workers.js';

test('selectAppScript prefers dev and supports explicit scripts', () => {
  const scripts = {
    start: 'node server.js',
    dev: 'vite',
    preview: 'vite preview'
  };

  assert.equal(selectAppScript(scripts), 'dev');
  assert.equal(selectAppScript(scripts, 'preview'), 'preview');
  assert.equal(selectAppScript(scripts, 'missing'), '');
});

test('detectAppLaunch reports the selected launch command without starting a worker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-detect-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      start: 'node server.js',
      dev: 'vite'
    }
  }));

  const result = await detectAppLaunch(root);

  assert.equal(result.source, 'package');
  assert.equal(result.script, 'dev');
  assert.equal(result.command, 'npm run dev');
});

test('startApp creates a task and managed worker for the selected script', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-launcher-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'node -e "console.log(\\"app launched\\")"'
    }
  }));

  const result = await startApp(root, { id: 'app-dev-test' });
  assert.equal(result.script, 'dev');
  assert.equal(result.command, 'npm run dev');
  assert.equal(result.task.title, 'Run app script: dev');
  assert.equal(result.worker.id, 'app-dev-test');

  await waitForWorkerOutput(root, 'app-dev-test', /app launched/);
  const finished = await waitForWorkerStatus(root, 'app-dev-test', worker => worker.status !== 'running');
  assert.equal(finished.status, 'done');
  const read = await readWorker(root, 'app-dev-test');
  assert.match(read.output, /app launched/);
});

test('startApp can use workspace profile command overrides', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-profile-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), JSON.stringify({
    app: {
      command: `${JSON.stringify(process.execPath)} -e "console.log('profile app launched')"`
    }
  }));

  const result = await startApp(root, { id: 'profile-app-test' });
  assert.equal(result.script, 'profile.command');
  assert.match(result.command, /profile app launched/);

  await waitForWorkerOutput(root, 'profile-app-test', /profile app launched/);
  const read = await readWorker(root, 'profile-app-test');
  assert.match(read.output, /profile app launched/);
});

test('startApp can launch Makefile app targets without package.json', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-make-'));
  await fs.writeFile(path.join(root, 'Makefile'), [
    'dev:',
    `\t${JSON.stringify(process.execPath)} -e "console.log('make app launched')"`,
    ''
  ].join('\n'));

  const result = await startApp(root, { id: 'make-app-test' });
  assert.equal(result.script, 'dev');
  assert.equal(result.command, 'make dev');

  await waitForWorkerOutput(root, 'make-app-test', /make app launched/);
});

test('detectAppLaunch supports Java Gradle and Maven app entrypoints', async () => {
  const gradleRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-gradle-'));
  await fs.writeFile(path.join(gradleRoot, 'build.gradle.kts'), [
    'plugins {',
    '  id("org.springframework.boot") version "3.0.0"',
    '}',
    ''
  ].join('\n'));

  const gradle = await detectAppLaunch(gradleRoot);
  assert.equal(gradle.source, 'java');
  assert.equal(gradle.script, 'bootRun');
  assert.equal(gradle.command, 'gradle bootRun');

  const mavenRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-maven-'));
  await fs.writeFile(path.join(mavenRoot, 'pom.xml'), [
    '<project>',
    '<artifactId>spring-boot-starter-web</artifactId>',
    '</project>',
    ''
  ].join('\n'));

  const maven = await detectAppLaunch(mavenRoot);
  assert.equal(maven.source, 'java');
  assert.equal(maven.script, 'spring-boot:run');
  assert.equal(maven.command, 'mvn spring-boot:run');
});

test('detectAppLaunch supports PHP Composer scripts and public entrypoints', async () => {
  const composerRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-composer-'));
  await fs.writeFile(path.join(composerRoot, 'composer.json'), JSON.stringify({
    scripts: {
      serve: 'php -S 127.0.0.1:8000 -t public'
    }
  }));

  const composer = await detectAppLaunch(composerRoot);
  assert.equal(composer.source, 'php');
  assert.equal(composer.script, 'serve');
  assert.equal(composer.command, 'composer run serve');

  const phpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-php-'));
  await fs.mkdir(path.join(phpRoot, 'public'));
  await fs.writeFile(path.join(phpRoot, 'public', 'index.php'), '<?php echo "ok";\n');

  const php = await detectAppLaunch(phpRoot);
  assert.equal(php.source, 'php');
  assert.equal(php.script, 'php-server');
  assert.equal(php.command, 'php -S 127.0.0.1:8000 -t public');
});

test('detectAppLaunch supports Ruby Rake, Rails, and Rack app entrypoints', async () => {
  const rakeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-rake-'));
  await fs.writeFile(path.join(rakeRoot, 'Rakefile'), 'task :serve\n');

  const rake = await detectAppLaunch(rakeRoot);
  assert.equal(rake.source, 'ruby');
  assert.equal(rake.script, 'serve');
  assert.equal(rake.command, 'rake serve');

  const railsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-rails-'));
  await fs.mkdir(path.join(railsRoot, 'config'));
  await fs.writeFile(path.join(railsRoot, 'Gemfile'), 'gem "rails"\n');
  await fs.writeFile(path.join(railsRoot, 'config', 'application.rb'), 'module Demo; class Application; end; end\n');

  const rails = await detectAppLaunch(railsRoot);
  assert.equal(rails.source, 'ruby');
  assert.equal(rails.script, 'rails-server');
  assert.equal(rails.command, 'bundle exec rails server -b 127.0.0.1');

  const rackRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-app-rack-'));
  await fs.writeFile(path.join(rackRoot, 'config.ru'), 'run ->(_) { [200, {}, ["ok"]] }\n');

  const rack = await detectAppLaunch(rackRoot);
  assert.equal(rack.source, 'ruby');
  assert.equal(rack.script, 'rackup');
  assert.equal(rack.command, 'rackup -o 127.0.0.1');
});

async function waitForWorkerOutput(root, id, pattern) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const read = await readWorker(root, id).catch(() => null);
    if (read?.output && pattern.test(read.output)) return read;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${id}`);
}

async function waitForWorkerStatus(root, id, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const read = await readWorker(root, id).catch(() => null);
    if (read && predicate(read)) return read;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${id} status`);
}
