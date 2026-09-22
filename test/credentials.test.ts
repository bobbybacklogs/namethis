import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { resolveExplicitApiKey } from '../src/credentials.js';

const trackedKeys = ['OPENAI_API_KEY', 'AI_GATEWAY_API_KEY'] as const;

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

  it('does not treat env keys as explicit chat credentials', () => {
    process.env.OPENAI_API_KEY = 'openai-env-key';
    process.env.AI_GATEWAY_API_KEY = 'gateway-env-key';

    assert.equal(resolveExplicitApiKey(undefined), undefined);
  });
});
