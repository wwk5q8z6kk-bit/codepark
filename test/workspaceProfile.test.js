import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  formatWorkspaceProfile,
  formatWorkspaceProfileInit,
  initWorkspaceProfile,
  readWorkspaceProfile
} from '../src/workspaceProfile.js';

test('initWorkspaceProfile writes inferred local workspace contract', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-profile-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      verify: 'node verify.js',
      dev: 'node dev.js'
    }
  }));
  await fs.writeFile(path.join(root, 'Containerfile'), 'FROM scratch\n');

  const result = await initWorkspaceProfile(root);
  assert.equal(result.path, path.join('.codepark', 'profile.json'));
  assert.equal(result.overwritten, false);
  assert.match(formatWorkspaceProfileInit(result), /Wrote \.codepark\/profile\.json/);

  const profile = await readWorkspaceProfile(root);
  assert.equal(profile.version, 1);
  assert.deepEqual(profile.hooks, {
    verify: ['npm run verify']
  });
  assert.deepEqual(profile.container.preferred, ['podman', 'docker']);
  assert.ok(profile.policy.write.allow.includes('package.json'));
  assert.ok(profile.policy.write.allow.includes('src/**'));
  assert.deepEqual(profile.policy.write.deny, ['.git/**', 'node_modules/**', '.env', '.env.*', 'dist/**', 'build/**', 'coverage/**']);
  assert.deepEqual(profile.policy.commands.denyCommands, ['sudo']);
  assert.deepEqual(profile.policy.commands.denyPatterns, ['npm publish', 'npm login']);
  assert.match(formatWorkspaceProfile(profile), /hooks: verify/);

  await assert.rejects(
    () => initWorkspaceProfile(root),
    /\.codepark\/profile\.json already exists/
  );
});

test('initWorkspaceProfile writes Python-scoped policy for Python projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-profile-python-'));
  await fs.writeFile(path.join(root, 'pyproject.toml'), '[project]\nname = "demo"\n');

  const result = await initWorkspaceProfile(root);

  assert.ok(result.profile.policy.write.allow.includes('pyproject.toml'));
  assert.ok(result.profile.policy.write.allow.includes('requirements*.txt'));
  assert.ok(result.profile.policy.write.deny.includes('.env'));
  assert.ok(result.profile.policy.commands.denyPatterns.includes('twine upload'));
});

test('initWorkspaceProfile writes Java-scoped policy for Java projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-profile-java-'));
  await fs.writeFile(path.join(root, 'pom.xml'), '<project></project>\n');

  const result = await initWorkspaceProfile(root);

  assert.ok(result.profile.policy.write.allow.includes('pom.xml'));
  assert.ok(result.profile.policy.write.allow.includes('gradle/**'));
  assert.ok(result.profile.policy.write.deny.includes('target/**'));
  assert.ok(result.profile.policy.commands.denyPatterns.includes('mvn deploy'));
});

test('initWorkspaceProfile writes PHP-scoped policy for PHP projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-profile-php-'));
  await fs.writeFile(path.join(root, 'composer.json'), '{"scripts":{"test":"phpunit"}}\n');

  const result = await initWorkspaceProfile(root);

  assert.ok(result.profile.policy.write.allow.includes('composer.json'));
  assert.ok(result.profile.policy.write.allow.includes('public/**'));
  assert.ok(result.profile.policy.write.deny.includes('vendor/**'));
  assert.ok(result.profile.policy.commands.denyPatterns.includes('composer global'));
});

test('initWorkspaceProfile writes Ruby-scoped policy for Ruby projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-profile-ruby-'));
  await fs.writeFile(path.join(root, 'Gemfile'), 'source "https://rubygems.org"\n');

  const result = await initWorkspaceProfile(root);

  assert.ok(result.profile.policy.write.allow.includes('Gemfile'));
  assert.ok(result.profile.policy.write.allow.includes('spec/**'));
  assert.ok(result.profile.policy.write.deny.includes('vendor/bundle/**'));
  assert.ok(result.profile.policy.commands.denyPatterns.includes('gem push'));
});

test('readWorkspaceProfile validates profile shape', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-profile-invalid-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), JSON.stringify({
    hooks: {
      verify: ['make verify']
    },
    app: {
      command: 'make dev'
    },
    container: {
      runtime: 'podman',
      preferred: ['podman']
    }
  }));

  const profile = await readWorkspaceProfile(root);
  assert.equal(profile.app.command, 'make dev');
  assert.equal(profile.container.runtime, 'podman');
  assert.deepEqual(profile.hooks.verify, ['make verify']);
  assert.deepEqual(profile.policy.write.deny, ['.git/**', 'node_modules/**']);
});

test('readWorkspaceProfile rejects malformed policy sections', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-profile-policy-invalid-'));
  await fs.mkdir(path.join(root, '.codepark'));
  await fs.writeFile(path.join(root, '.codepark', 'profile.json'), JSON.stringify({
    policy: {
      write: ['src/**']
    }
  }));

  await assert.rejects(
    () => readWorkspaceProfile(root),
    /policy\.write must be an object/
  );
});
