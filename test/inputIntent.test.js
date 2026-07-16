import assert from 'node:assert/strict';
import test from 'node:test';
import { expandSelfReference, isBareSelfReference } from '../src/inputIntent.js';

test('isBareSelfReference detects one-word self references', () => {
  assert.equal(isBareSelfReference('yourself'), true);
  assert.equal(isBareSelfReference('fix yourself'), false);
});

test('expandSelfReference turns yourself into a CodePark task', () => {
  const result = expandSelfReference('yourself');
  assert.match(result, /CodePark itself/);
  assert.match(result, /Do not ask/);
  assert.match(result, /Do not modify files/);
});

test('expandSelfReference leaves specific prompts unchanged', () => {
  assert.equal(expandSelfReference('read package.json'), 'read package.json');
});
