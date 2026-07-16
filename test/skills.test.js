import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  formatInstalledSkillPackage,
  formatLocalSkill,
  formatLocalSkillList,
  formatPackedSkill,
  installSkillPackage,
  listLocalSkills,
  packLocalSkill,
  readLocalSkill
} from '../src/skills.js';

test('local skills list markdown files under .codepark/skills', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skills-'));
  await fs.mkdir(path.join(root, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');
  await fs.writeFile(path.join(root, '.codepark', 'skills', 'debug.md'), '# Debug\n\nTrace causes.\n');

  const skills = await listLocalSkills(root, 'review');
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, 'review');

  const formatted = formatLocalSkillList(skills);
  assert.match(formatted, /review/);
  assert.match(formatted, /Review/);
});

test('local skills read by id with provenance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skills-'));
  await fs.mkdir(path.join(root, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(root, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');

  const skill = await readLocalSkill(root, 'review');
  assert.equal(skill.id, 'review');
  assert.equal(skill.path, '.codepark/skills/review.md');

  const formatted = formatLocalSkill(skill);
  assert.match(formatted, /Local skill: review/);
  assert.match(formatted, /Check risks/);
});

test('local skills can be packed and installed into another workspace', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skills-source-'));
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skills-target-'));
  await fs.mkdir(path.join(source, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(source, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');
  const packagePath = path.join(source, 'review.skill.json');

  const packed = await packLocalSkill(source, 'review', packagePath);
  assert.equal(packed.id, 'review');
  assert.equal(packed.path, packagePath);
  assert.match(formatPackedSkill(packed), /Skill package written/);

  const packageContent = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  assert.equal(packageContent.schema, 'codepark.skill-package.v1');
  assert.equal(packageContent.id, 'review');
  assert.equal(packageContent.files[0].path, 'review.md');

  const installed = await installSkillPackage(target, packagePath);
  assert.equal(installed.id, 'review');
  assert.equal(installed.path, '.codepark/skills/review.md');
  assert.match(formatInstalledSkillPackage(installed), /Skill package installed/);

  const skill = await readLocalSkill(target, 'review');
  assert.match(skill.content, /Check risks/);
});

test('installing a skill package can override the local skill id', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skills-source-'));
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skills-target-'));
  await fs.mkdir(path.join(source, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(source, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');
  const packagePath = path.join(source, 'review.skill.json');
  await packLocalSkill(source, 'review', packagePath);

  const installed = await installSkillPackage(target, packagePath, { id: 'shared-review' });

  assert.equal(installed.id, 'shared-review');
  assert.equal(installed.path, '.codepark/skills/shared-review.md');
  const skill = await readLocalSkill(target, 'shared-review');
  assert.match(skill.content, /Check risks/);
});

test('installing a skill package refuses to overwrite existing skills by default', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skills-source-'));
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-skills-target-'));
  await fs.mkdir(path.join(source, '.codepark', 'skills'), { recursive: true });
  await fs.mkdir(path.join(target, '.codepark', 'skills'), { recursive: true });
  await fs.writeFile(path.join(source, '.codepark', 'skills', 'review.md'), '# Review\n\nCheck risks.\n');
  await fs.writeFile(path.join(target, '.codepark', 'skills', 'review.md'), '# Existing\n');
  const packagePath = path.join(source, 'review.skill.json');
  await packLocalSkill(source, 'review', packagePath);

  await assert.rejects(
    () => installSkillPackage(target, packagePath),
    /local skill already exists/
  );
});
