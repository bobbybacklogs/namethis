import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildModelHitchClientOptions } from '../src/modelhitch-client.js';

describe('buildModelHitchClientOptions', () => {
  it('uses ModelHitch autoMode when no user policy is configured', async () => {
    const options = await buildModelHitchClientOptions(null);
    assert.equal(options.autoMode, true);
    assert.equal(options.policy, undefined);
  });

  it('uses ModelHitch policy when ~/.modelhitch config provides lanes', async () => {
    const options = await buildModelHitchClientOptions({
      version: 1,
      policy: {
        trusted: [{ providerId: 'vercel-ai-gateway', models: ['openai/gpt-5.4'] }],
        fallback: [],
      },
      defaultProviderId: 'vercel-ai-gateway',
      defaultModel: 'openai/gpt-5.4',
    });

    assert.equal(options.autoMode, undefined);
    assert.deepEqual(options.policy?.trusted, [
      { providerId: 'vercel-ai-gateway', models: ['openai/gpt-5.4'] },
    ]);
    assert.equal(options.defaultProviderId, 'vercel-ai-gateway');
    assert.equal(options.defaultModel, 'openai/gpt-5.4');
  });
});
