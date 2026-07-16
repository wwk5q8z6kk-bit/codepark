import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatHarnessInit, inferHarnessHooks, inferWorkspaceHooks, initHarness } from '../src/harness.js';

test('inferHarnessHooks prefers verify and adds auxiliary finite hooks', () => {
  const hooks = inferHarnessHooks({
    verify: 'npm run check && npm test',
    check: 'node --check index.js',
    test: 'node --test',
    build: 'vite build',
    smoke: 'node smoke.js',
    dev: 'vite'
  }, 'pnpm');

  assert.deepEqual(hooks, {
    verify: ['pnpm run verify'],
    build: ['pnpm run build'],
    smoke: ['pnpm run smoke']
  });
});

test('initHarness writes inferred hooks without overwriting existing config', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      check: 'node --check index.js',
      lint: 'eslint .',
      test: 'node --test',
      build: 'vite build',
      'smoke:all': 'node smoke-all.js'
    }
  }));

  const result = await initHarness(root);
  assert.equal(result.path, path.join('.codepark', 'hooks.json'));
  assert.equal(result.packageManager, 'npm');
  assert.equal(result.overwritten, false);
  assert.match(formatHarnessInit(result), /Next: run \/hooks/);

  const config = JSON.parse(await fs.readFile(path.join(root, '.codepark', 'hooks.json'), 'utf8'));
  assert.deepEqual(config.hooks, {
    verify: ['npm run check', 'npm run lint', 'npm run test'],
    build: ['npm run build'],
    'smoke:all': ['npm run smoke:all']
  });

  await assert.rejects(
    () => initHarness(root),
    /\.codepark\/hooks\.json already exists/
  );
});

test('initHarness force replaces existing hook config', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-force-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'hooks.json'), JSON.stringify({
    hooks: { old: ['npm run old'] }
  }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      verify: 'node verify.js'
    }
  }));

  const result = await initHarness(root, { force: true });
  assert.equal(result.overwritten, true);

  const config = JSON.parse(await fs.readFile(path.join(root, '.codepark', 'hooks.json'), 'utf8'));
  assert.deepEqual(config.hooks, {
    verify: ['npm run verify']
  });
});

test('inferWorkspaceHooks supports Make, Go, Rust, and Python adapters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-adapters-'));
  await fs.writeFile(path.join(root, 'Makefile'), [
    'verify:',
    '\ttrue',
    'smoke:',
    '\ttrue',
    ''
  ].join('\n'));
  await fs.writeFile(path.join(root, 'go.mod'), 'module example.com/app\n');
  await fs.writeFile(path.join(root, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n');
  await fs.writeFile(path.join(root, 'pyproject.toml'), '[project]\nname = "demo"\n');

  const result = await inferWorkspaceHooks(root);
  assert.deepEqual(result.adapters, ['make', 'go', 'rust', 'python']);
  assert.deepEqual(result.hooks, {
    verify: ['make verify'],
    smoke: ['make smoke'],
    build: ['go build ./...']
  });
});

test('initHarness can bootstrap non-Node workspaces', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-make-'));
  await fs.writeFile(path.join(root, 'Makefile'), 'test:\n\ttrue\nbuild:\n\ttrue\n');

  const result = await initHarness(root);
  assert.deepEqual(result.adapters, ['make']);

  const config = JSON.parse(await fs.readFile(path.join(root, '.codepark', 'hooks.json'), 'utf8'));
  assert.deepEqual(config.hooks, {
    test: ['make test'],
    build: ['make build']
  });
});

test('inferWorkspaceHooks supports Java Gradle and Maven adapters', async () => {
  const gradleRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-gradle-'));
  await fs.writeFile(path.join(gradleRoot, 'build.gradle.kts'), 'plugins { java }\n');

  const gradle = await inferWorkspaceHooks(gradleRoot);
  assert.deepEqual(gradle.adapters, ['java']);
  assert.deepEqual(gradle.hooks, {
    verify: ['gradle test'],
    build: ['gradle build']
  });

  const mavenRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-maven-'));
  await fs.writeFile(path.join(mavenRoot, 'pom.xml'), '<project></project>\n');

  const maven = await inferWorkspaceHooks(mavenRoot);
  assert.deepEqual(maven.adapters, ['java']);
  assert.deepEqual(maven.hooks, {
    verify: ['mvn test'],
    build: ['mvn package -DskipTests']
  });
});

test('inferWorkspaceHooks supports PHP Composer and PHPUnit adapters', async () => {
  const composerRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-composer-'));
  await fs.writeFile(path.join(composerRoot, 'composer.json'), JSON.stringify({
    scripts: {
      lint: 'php -l src',
      test: 'phpunit',
      build: 'php build.php'
    }
  }));

  const composer = await inferWorkspaceHooks(composerRoot);
  assert.deepEqual(composer.adapters, ['php']);
  assert.deepEqual(composer.hooks, {
    verify: ['composer run lint', 'composer run test'],
    build: ['composer run build']
  });

  const phpunitRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-phpunit-'));
  await fs.writeFile(path.join(phpunitRoot, 'phpunit.xml'), '<phpunit></phpunit>\n');

  const phpunit = await inferWorkspaceHooks(phpunitRoot);
  assert.deepEqual(phpunit.adapters, ['php']);
  assert.deepEqual(phpunit.hooks, {
    verify: ['vendor/bin/phpunit']
  });
});

test('inferWorkspaceHooks supports Ruby Rake adapters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-harness-ruby-'));
  await fs.writeFile(path.join(root, 'Gemfile'), 'source "https://rubygems.org"\n');
  await fs.writeFile(path.join(root, 'Rakefile'), 'task :test\n');

  const result = await inferWorkspaceHooks(root);
  assert.deepEqual(result.adapters, ['ruby']);
  assert.deepEqual(result.hooks, {
    verify: ['bundle exec rake test']
  });
});
