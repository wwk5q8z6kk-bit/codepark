const secretNamePattern = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)/i;

export function createSubprocessEnv(baseEnv = process.env, options = {}) {
  const keepSecrets = Boolean(options.keepSecrets);
  const env = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (value == null) continue;
    if (!keepSecrets && isSecretEnvName(key)) continue;
    env[key] = value;
  }
  return env;
}

export function isSecretEnvName(name) {
  return secretNamePattern.test(String(name ?? ''));
}
