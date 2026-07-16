import { isCodexBaseUrl, isLocalOnlyBaseUrl, modelAuthStatus } from './config.js';
import { runDoctor } from './doctor.js';
import { readPackageJson } from './project.js';
import { readWorkspacePolicy } from './workspacePolicy.js';

export async function createReadinessReport(cwd, config, options = {}) {
  const packageJson = await readPackageJson(cwd);
  const doctor = await runDoctor(config, {
    cwd,
    configDir: options.configDir,
    configPath: options.configPath,
    mcpHealth: false
  });
  const auth = modelAuthStatus(config);
  const endpoint = endpointSummary(config);
  const policy = await readWorkspacePolicy(cwd);
  const localChecks = localReadinessChecks({ config, doctor, auth });
  const secureHarnessChecks = secureHarnessReadinessChecks({ config, doctor, policy });

  return {
    version: 1,
    cwd,
    endpoint,
    package: packageSummary(packageJson),
    localUse: summarizeChecks(localChecks),
    secureHarness: summarizeChecks(secureHarnessChecks),
    checks: {
      localUse: localChecks,
      secureHarness: secureHarnessChecks
    }
  };
}

export function formatReadinessReport(report) {
  return [
    'CodePark readiness',
    '',
    'Endpoint:',
    `- provider: ${report.endpoint.provider}`,
    `- mode: ${report.endpoint.mode}`,
    `- base URL: ${report.endpoint.baseUrl}`,
    `- chat completions: ${report.endpoint.chatCompletionsUrl}`,
    `- local-only: ${report.endpoint.localOnly ? 'yes' : 'no'}`,
    `- secure mode: ${report.endpoint.secureMode ? 'yes' : 'no'}`,
    '',
    'Project:',
    `- name: ${report.package.name}`,
    `- version: ${report.package.version}`,
    `- license: ${report.package.license}`,
    '',
    `Local use: ${report.localUse.ready ? 'ready' : 'not ready'}`,
    ...formatChecks(report.checks.localUse),
    '',
    `Secure harness: ${report.secureHarness.ready ? 'ready' : 'not ready'}`,
    ...formatChecks(report.checks.secureHarness)
  ].join('\n');
}

export function formatReadinessReportJson(report) {
  return JSON.stringify(report, null, 2);
}

function endpointSummary(config) {
  const baseUrl = String(config.baseUrl ?? '');
  const codex = isCodexBaseUrl(baseUrl);
  return {
    provider: config.provider || 'custom',
    mode: codex ? 'codex-cli' : 'openai-compatible-http',
    baseUrl,
    chatCompletionsUrl: codex ? 'codex CLI' : `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
    secureMode: Boolean(config.secureMode),
    localOnly: Boolean(config.localOnly),
    localOnlyCompatible: !config.localOnly || isLocalOnlyBaseUrl(baseUrl)
  };
}

function packageSummary(packageJson) {
  return {
    name: packageJson?.name ?? '',
    version: packageJson?.version ?? '',
    license: packageJson?.license ?? ''
  };
}

function localReadinessChecks({ config, doctor, auth }) {
  return [
    check('node', doctor.node.ok, doctor.node.message),
    check('model-auth', auth.ok, auth.message),
    check('base-url', Boolean(config.baseUrl), config.baseUrl || 'base URL missing'),
    check(
      'local-only-endpoint',
      !config.localOnly || isLocalOnlyBaseUrl(config.baseUrl),
      config.localOnly ? 'local-only endpoint must be codex:// or localhost' : 'local-only disabled'
    ),
    check(
      'secure-mode',
      !config.secureMode || config.localOnly,
      config.secureMode ? 'secure mode implies local-only and explicit approvals' : 'secure mode disabled'
    ),
    check('config-permissions', doctor.configDir.ok && doctor.configFile.ok, `${doctor.configDir.message}; ${doctor.configFile.message}`),
    check('workflow-files', doctor.hooks.ok && doctor.skills.ok && doctor.tasks.ok && doctor.workers.ok, 'workspace workflow files are valid')
  ];
}

function secureHarnessReadinessChecks({ config, doctor, policy }) {
  return [
    check(
      'secure-endpoint',
      Boolean(config.secureMode) && Boolean(config.localOnly) && isLocalOnlyBaseUrl(config.baseUrl),
      config.secureMode && config.localOnly ? 'secure local-only endpoint enabled' : 'launch with --secure or CODEPARK_SECURE_MODE=1'
    ),
    check('launcher', doctor.launcher.ok, doctor.launcher.message),
    check(
      'write-scope',
      policy.write.allow.length > 0,
      policy.write.allow.length ? `writes scoped to ${policy.write.allow.join(', ')}` : 'writes allow the whole workspace'
    ),
    check(
      'sensitive-paths',
      includesAll(policy.write.deny, ['.git/**', '.env', '.env.*']),
      `write deny: ${policy.write.deny.length ? policy.write.deny.join(', ') : 'none'}`
    ),
    check(
      'deployment-commands',
      policy.commands.denyPatterns.length > 0,
      policy.commands.denyPatterns.length ? `blocked fragments: ${policy.commands.denyPatterns.join(', ')}` : 'no command fragments are blocked by workspace policy'
    )
  ];
}

function check(name, ok, message) {
  return { name, ok: Boolean(ok), message };
}

function summarizeChecks(checks) {
  const failed = checks.filter(item => !item.ok);
  return { ready: failed.length === 0, passed: checks.length - failed.length, failed: failed.length };
}

function formatChecks(checks) {
  return checks.map(item => `- ${item.ok ? 'ok' : 'fail'} ${item.name}: ${item.message}`);
}

function includesAll(items, required) {
  return required.every(item => items.includes(item));
}
