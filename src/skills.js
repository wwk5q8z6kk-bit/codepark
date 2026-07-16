import fs from 'node:fs/promises';
import path from 'node:path';

const skillsDir = path.join('.codepark', 'skills');
const maxSkillBytes = 60000;
const maxPackageBytes = 250000;
const skillPackageSchema = 'codepark.skill-package.v1';

export async function listLocalSkills(cwd, query = '') {
  const root = path.join(cwd, skillsDir);
  const files = [];
  await walkMarkdown(root, root, files).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
  const needle = String(query ?? '').trim().toLowerCase();
  const skills = [];
  for (const file of files.sort()) {
    const content = await fs.readFile(path.join(root, file), 'utf8');
    const skill = skillFromFile(file, content);
    if (needle && !matchesSkill(skill, needle)) continue;
    skills.push(skill);
  }
  return skills;
}

export async function readLocalSkill(cwd, id) {
  const skills = await listLocalSkills(cwd);
  const skill = resolveSkill(skills, id);
  const absolutePath = path.join(cwd, skill.path);
  const buffer = await fs.readFile(absolutePath);
  const content = buffer.subarray(0, maxSkillBytes).toString('utf8');
  const suffix = buffer.length > maxSkillBytes ? '\n[truncated]' : '';
  return { ...skill, content: `${content}${suffix}` };
}

export async function packLocalSkill(cwd, id, outputPath) {
  const skills = await listLocalSkills(cwd);
  const skill = resolveSkill(skills, id);
  const absoluteSkillPath = path.join(cwd, skill.path);
  const content = await fs.readFile(absoluteSkillPath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > maxPackageBytes) {
    throw new Error(`local skill is too large to package: ${skill.path}`);
  }

  const packagePath = path.resolve(cwd, String(outputPath ?? '').trim());
  if (!String(outputPath ?? '').trim()) throw new Error('skill package output path is required');
  const packageFile = {
    schema: skillPackageSchema,
    id: normalizeSkillPath(skill.id),
    title: skill.title,
    packedAt: new Date().toISOString(),
    files: [
      {
        path: toPosix(path.relative(path.join(cwd, skillsDir), absoluteSkillPath)),
        content
      }
    ]
  };

  await fs.mkdir(path.dirname(packagePath), { recursive: true });
  await fs.writeFile(packagePath, `${JSON.stringify(packageFile, null, 2)}\n`, { flag: 'wx' }).catch(error => {
    if (error?.code === 'EEXIST') throw new Error(`skill package already exists: ${packagePath}`);
    throw error;
  });

  return {
    id: packageFile.id,
    title: packageFile.title,
    path: packagePath,
    skillPath: skill.path,
    files: packageFile.files.length
  };
}

export async function installSkillPackage(cwd, packagePath, options = {}) {
  const absolutePackagePath = path.resolve(cwd, String(packagePath ?? '').trim());
  if (!String(packagePath ?? '').trim()) throw new Error('skill package path is required');
  const buffer = await fs.readFile(absolutePackagePath);
  if (buffer.length > maxPackageBytes) throw new Error(`skill package is too large: ${absolutePackagePath}`);
  const parsed = parseSkillPackage(buffer.toString('utf8'), absolutePackagePath);
  const file = parsed.files[0];
  const installId = options.id ? normalizeSkillPath(options.id) : parsed.id;
  const installFile = options.id ? `${installId}.md` : file.path;
  const relativePath = toPosix(path.join(skillsDir, installFile));
  const absoluteSkillPath = path.join(cwd, relativePath);

  await fs.mkdir(path.dirname(absoluteSkillPath), { recursive: true });
  await fs.writeFile(absoluteSkillPath, file.content, { flag: options.overwrite ? 'w' : 'wx' }).catch(error => {
    if (error?.code === 'EEXIST') throw new Error(`local skill already exists: ${relativePath}`);
    throw error;
  });

  return {
    id: installId,
    title: parsed.title,
    path: relativePath,
    packagePath: absolutePackagePath,
    overwritten: Boolean(options.overwrite)
  };
}

export function formatLocalSkillList(skills) {
  if (!skills.length) return 'No local skills.';
  return skills.map(skill => `${skill.id} | ${skill.title} | ${skill.path}`).join('\n');
}

export function formatPackedSkill(result) {
  return [
    'Skill package written:',
    `id: ${result.id}`,
    `path: ${result.path}`,
    `skill: ${result.skillPath}`,
    `files: ${result.files}`
  ].join('\n');
}

export function formatInstalledSkillPackage(result) {
  return [
    'Skill package installed:',
    `id: ${result.id}`,
    `path: ${result.path}`,
    `package: ${result.packagePath}`,
    `overwritten: ${result.overwritten ? 'yes' : 'no'}`
  ].join('\n');
}

export function formatLocalSkill(skill) {
  return [
    `Local skill: ${skill.id}`,
    `Title: ${skill.title}`,
    `Path: ${skill.path}`,
    '',
    skill.content
  ].join('\n');
}

async function walkMarkdown(root, directory, files) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(root, absolute, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(toPosix(path.relative(root, absolute)));
    }
  }
}

function skillFromFile(file, content) {
  const id = file.replace(/\.md$/i, '');
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(id);
  return {
    id,
    title,
    path: toPosix(path.join(skillsDir, file)),
    preview: content.split(/\r?\n/).slice(0, 4).join('\n').trim()
  };
}

function resolveSkill(skills, id) {
  const needle = String(id ?? '').trim();
  if (!needle) throw new Error('skill id is required');
  const exact = skills.find(skill => skill.id === needle);
  if (exact) return exact;
  const matches = skills.filter(skill => skill.id.startsWith(needle));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`skill id prefix is ambiguous: ${needle}`);
  throw new Error(`skill not found: ${needle}`);
}

function matchesSkill(skill, needle) {
  return [skill.id, skill.title, skill.path, skill.preview]
    .some(value => String(value).toLowerCase().includes(needle));
}

function normalizeSkillPath(value) {
  const id = String(value ?? '').trim().replace(/\.md$/i, '');
  if (!id) throw new Error('skill id is required');
  const normalized = toPosix(id);
  const segments = normalized.split('/');
  if (normalized.startsWith('/') || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('skill id must be a relative path');
  }
  for (const segment of segments) {
    if (!/^[A-Za-z0-9_.-]+$/.test(segment)) {
      throw new Error('skill id may contain only letters, numbers, dot, underscore, dash, and path separators');
    }
  }
  return segments.join('/');
}

function parseSkillPackage(content, packagePath) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`skill package invalid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('skill package must be an object');
  if (parsed.schema !== skillPackageSchema) throw new Error(`unsupported skill package schema in ${packagePath}`);
  const id = normalizeSkillPath(parsed.id);
  const title = String(parsed.title ?? id).trim() || id;
  if (!Array.isArray(parsed.files) || parsed.files.length !== 1) {
    throw new Error('skill package must contain exactly one markdown skill file');
  }
  const file = parsed.files[0];
  if (!file || typeof file !== 'object') throw new Error('skill package file entry must be an object');
  const filePath = normalizePackageFilePath(file.path);
  if (typeof file.content !== 'string') throw new Error('skill package file content must be a string');
  return {
    id,
    title,
    files: [{ path: filePath, content: file.content }]
  };
}

function normalizePackageFilePath(value) {
  const raw = String(value ?? '').trim().replaceAll('\\', '/');
  if (!raw) throw new Error('skill package file path is required');
  if (raw.startsWith('/')) throw new Error('skill package file path must be relative');
  const segments = raw.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('skill package file path must not contain dot segments');
  }
  if (!raw.endsWith('.md')) throw new Error('skill package file path must end with .md');
  normalizeSkillPath(raw);
  return segments.join('/');
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}
