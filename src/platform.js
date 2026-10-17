export function isWindows() {
  return process.platform === 'win32';
}

export function defaultShell() {
  return isWindows()
    ? (process.env.ComSpec || process.env.COMSPEC || 'cmd.exe')
    : (process.env.SHELL || '/bin/sh');
}

export function commandShell() {
  return isWindows() ? true : defaultShell();
}

export function executableNames(name, env = process.env) {
  if (!isWindows()) return [name];
  const extensions = (env?.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean);
  return [
    name,
    ...extensions.flatMap(extension => [
      `${name}${extension.toLowerCase()}`,
      `${name}${extension.toUpperCase()}`
    ])
  ];
}
