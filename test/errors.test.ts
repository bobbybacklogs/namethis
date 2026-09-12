import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ExhaustedError } from 'modelhitch';
import { formatGenerationFailure } from '../src/errors.js';

describe('formatGenerationFailure', () => {
  it('explains context overflow separately from credential failures', () => {
    const err = new ExhaustedError(
      new Error('request exceeds the available context size (4096 tokens)'),
      {
        targets: [
          { providerId: 'ollama', model: 'deepseek-r1:7b' },
        ],
        attempts: [
          {
            target: { providerId: 'ollama', model: 'deepseek-r1:7b' },
            error: {
              code: 'provider-error',
              message:
                'request (9644 tokens) exceeds the available context size (4096 tokens)',
            },
          },
        ],
        firstError: new Error('context overflow'),
      }
    );

    const failure = formatGenerationFailure(err);
    assert.match(failure.message, /context window/i);
    assert.match(failure.hint || '', /--crawl/i);
  });

  it('explains vercel login vs gateway key mismatch', () => {
    const err = new ExhaustedError(
      new Error('invalid-api-key'),
      {
        targets: [{ providerId: 'vercel-ai-gateway', model: 'openai/gpt-5.4' }],
        attempts: [
          {
            target: { providerId: 'vercel-ai-gateway', model: 'openai/gpt-5.4' },
            error: {
              code: 'invalid-api-key',
              message: 'Provider "vercel-ai-gateway" rejected the API key.',
            },
          },
        ],
        firstError: new Error('invalid-api-key'),
      }
    );

    process.env.VERCEL_TOKEN = 'vercel-cli-token';
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const failure = formatGenerationFailure(err);
    assert.match(failure.message, /AI_GATEWAY_API_KEY|Vercel CLI token/i);
    assert.match(failure.hint || '', /vercel\.com\/ai-gateway/i);
  });
});
