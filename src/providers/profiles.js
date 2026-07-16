import { CodeParkError } from '../errors.js';

const profiles = {
  openai: {
    name: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    requiresApiKey: true
  },
  openrouter: {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    requiresApiKey: true
  },
  codex: {
    name: 'codex',
    baseUrl: 'codex://cli',
    defaultModel: 'codex-cli-default',
    apiKeyEnv: '',
    requiresApiKey: false
  },
  ollama: {
    name: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    apiKeyEnv: 'CODEPARK_API_KEY',
    requiresApiKey: false
  },
  local: {
    name: 'local',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    apiKeyEnv: 'CODEPARK_API_KEY',
    requiresApiKey: false
  }
};

export function listProviderProfiles() {
  return Object.values(profiles);
}

export function resolveProviderProfile(name) {
  const profile = profiles[String(name ?? '').toLowerCase()];
  if (!profile) throw new CodeParkError('EARGS', `unknown provider: ${name}`);
  return profile;
}
