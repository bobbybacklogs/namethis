import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExhaustedError } from 'modelhitch';
import { formatGenerationFailure } from '../src/errors.js';

describe('formatGenerationFailure', () => {
  it('explains context overflow separately from credential failures', () => {
    const err = new ExhaustedError(
      new Error('request exceeds the available context size (4096 tokens)'),
      {
        targets: [{ providerId: 'ollama', model: 'deepseek-r1:7b' }],
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

  it('reports credential exhaustion without blaming vercel login by default', () => {
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

    const failure = formatGenerationFailure(err);
    assert.match(failure.message, /No valid AI credentials/i);
    assert.match(failure.hint || '', /AI_GATEWAY_API_KEY|--key/i);
    assert.doesNotMatch(failure.message, /vercel login/i);
  });
});
