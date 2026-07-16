import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSystemPrompt, loadWorkspaceInstructions } from '../src/instructions.js';

test('loadWorkspaceInstructions reads project-local instruction files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-instructions-'));
  await fs.mkdir(path.join(root, '.codepark'), { recursive: true });
  await fs.writeFile(path.join(root, 'AGENTS.md'), 'Always run tests.');
  await fs.writeFile(path.join(root, '.codepark', 'rules.md'), 'Prefer small edits.');

  const instructions = await loadWorkspaceInstructions(root);

  assert.deepEqual(instructions.map(item => item.path), ['AGENTS.md', '.codepark/rules.md']);
  assert.match(instructions[0].content, /Always run tests/);
  assert.match(instructions[1].content, /Prefer small edits/);
});

test('createSystemPrompt includes workspace instructions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codepark-instructions-'));
  await fs.writeFile(path.join(root, 'AGENTS.md'), 'Use the local style guide.');

  const prompt = await createSystemPrompt(root);

  assert.match(prompt, /You are CodePark/);
  assert.match(prompt, /Workspace instructions/);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /Use the local style guide/);
});
