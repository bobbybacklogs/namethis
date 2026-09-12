import assert from 'node:assert/strict';
import type { Provider } from 'modelhitch';
import { afterEach, describe, it } from 'node:test';
import {
  findConfiguredProvider,
  hasCloudCredentials,
  hasConfiguredProviderCredential,
  providerCredentialEnvNames,
  resolveExplicitApiKey,
} from '../src/credentials.js';

const trackedKeys = [
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'VERCEL_TOKEN',
  'OPENAI_API_KEY',
] as const;

const gatewayProvider = {
  id: 'vercel-ai-gateway',
  name: 'Vercel AI Gateway',
  defaultModel: 'openai/gpt-5.4',
  config: {
    apiKeyEnvVar: 'AI_GATEWAY_API_KEY',
    apiKeyEnvFallbacks: ['VERCEL_OIDC_TOKEN', 'VERCEL_TOKEN'],
  },
} as unknown as Provider;

const openAiProvider = {
  id: 'openai',
  name: 'OpenAI',
  defaultModel: 'gpt-4o-mini',
  apiKeyEnvVar: 'OPENAI_API_KEY',
} as unknown as Provider;

afterEach(() => {
  for (const key of trackedKeys) {
    delete process.env[key];
  }
});

describe('credentials', () => {
  it('only treats CLI --key as an explicit api key', () => {
    process.env.OPENAI_API_KEY = 'openai-env-key';
    process.env.AI_GATEWAY_API_KEY = 'gateway-env-key';

    assert.equal(resolveExplicitApiKey(undefined), undefined);
    assert.equal(resolveExplicitApiKey('  gateway-cli-key  '), 'gateway-cli-key');
  });

  it('detects configured providers the same way Dirgest does', () => {
    assert.deepEqual(providerCredentialEnvNames(gatewayProvider), [
      'AI_GATEWAY_API_KEY',
      'VERCEL_OIDC_TOKEN',
      'VERCEL_TOKEN',
    ]);

    process.env.AI_GATEWAY_API_KEY = 'gateway-env-key';
    assert.equal(hasConfiguredProviderCredential(gatewayProvider), true);
    assert.equal(findConfiguredProvider([openAiProvider, gatewayProvider])?.id, 'vercel-ai-gateway');
  });

  it('routes to cloud when AI_GATEWAY_API_KEY is configured', () => {
    process.env.AI_GATEWAY_API_KEY = 'gateway-env-key';

    assert.equal(hasCloudCredentials(undefined, [gatewayProvider, openAiProvider]), true);
    assert.equal(findConfiguredProvider([gatewayProvider, openAiProvider])?.id, 'vercel-ai-gateway');
  });

  it('does not treat env keys as explicit chat credentials', () => {
    process.env.OPENAI_API_KEY = 'openai-env-key';
    process.env.AI_GATEWAY_API_KEY = 'gateway-env-key';

    assert.equal(resolveExplicitApiKey(undefined), undefined);
  });
});
