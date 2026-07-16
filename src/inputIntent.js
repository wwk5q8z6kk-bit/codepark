const bareSelfReferencePattern = /^(yourself|you|codepark|this|this app|the app|the tool|it)$/i;

export function isBareSelfReference(input) {
  return bareSelfReferencePattern.test(String(input ?? '').trim());
}

export function expandSelfReference(input) {
  const value = String(input ?? '').trim();
  if (!isBareSelfReference(value)) {
    return value;
  }

  return [
    'Do a quick self-check of CodePark itself in the current workspace.',
    'Do not ask what "yourself" means.',
    'Inspect package.json, README.md, and the src directory, then summarize current status and one concrete next improvement.',
    'Do not modify files for this exact self-check unless the user explicitly asks to fix, build, or change something.'
  ].join(' ');
}
