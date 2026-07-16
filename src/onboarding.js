import { saveConfig } from './config.js';
import { resolveProviderProfile } from './providers/profiles.js';

const configEnvNames = [
  'CODEPARK_PROVIDER',
  'CODEPARK_BASE_URL',
  'CODEPARK_MODEL',
  'CODEPARK_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL'
];

export function shouldRunFirstRunOnboarding({ flags = {}, env = process.env, inputIsTty = false, configExists = false }) {
  if (!inputIsTty) return false;
  if (configExists) return false;
  if (flags.provider || flags.baseUrl || flags.model) return false;
  return !configEnvNames.some(name => Boolean(env[name]));
}

export async function runOnboarding(config, { rl }) {
  console.log('First-run setup');
  console.log('Press Enter to use Codex CLI with your existing local login. No CodePark API key is needed.');

  const providerName = await promptWithDefault(rl, 'Provider', 'codex');
  const profile = resolveProviderProfile(providerName);
  const baseUrl = await promptWithDefault(rl, 'Base URL', profile.baseUrl);
  const model = await promptWithDefault(rl, 'Model', profile.defaultModel);

  const next = {
    provider: profile.name,
    baseUrl,
    model
  };

  await saveConfig(next);
  Object.assign(config, {
    provider: profile.name,
    baseUrl,
    model,
    apiKey: config.apiKey ?? ''
  });
  console.log(`Provider set to ${profile.name}`);
}

async function promptWithDefault(rl, label, fallback) {
  const answer = await rl.question(`${label} [${fallback}]: `);
  return answer.trim() || fallback;
}
