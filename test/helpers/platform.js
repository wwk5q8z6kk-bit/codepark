import fs from 'node:fs/promises';
import path from 'node:path';

export const isWindows = process.platform === 'win32';

export async function writeNodeScript(directory, name, source = '') {
  const script = path.join(directory, `${name}.js`);
  await fs.writeFile(script, source.endsWith('\n') ? source : `${source}\n`);
  return script;
}

export function nodeCommand(script) {
  return [process.execPath, script].map(quoteCommandWord).join(' ');
}

export async function writeNodeExecutable(directory, name, source = '') {
  const script = isWindows
    ? path.join(directory, `${name}.js`)
    : path.join(directory, name);
  const body = source.startsWith('#!') ? source : `#!/usr/bin/env node\n${source}`;
  await fs.writeFile(script, body.endsWith('\n') ? body : `${body}\n`);

  if (!isWindows) {
    await fs.chmod(script, 0o755);
    return script;
  }

  const launcher = path.join(directory, `${name}.cmd`);
  await fs.writeFile(
    launcher,
    `@echo off\r\n"${process.execPath}" "%~dp0${name}.js" %*\r\n`
  );
  return launcher;
}

function quoteCommandWord(value) {
  const text = String(value);
  return isWindows
    ? `"${text.replaceAll('"', '""')}"`
    : JSON.stringify(text);
}
