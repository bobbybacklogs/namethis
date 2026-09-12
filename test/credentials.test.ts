import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  getVercelTokenMisconfiguration,
  hasCloudCredentials,
  hasGatewayCredentials,
  resolveGatewayApiKey,
} from '../src/credentials.js';

const trackedKeys = [
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'VERCEL_TOKEN',
  'OPENAI_API_KEY',
] as const;

afterEach(() => {
  for (const key of trackedKeys) {
    delete process.env[key];
  }
});

describe('credentials', () => {
  it('treats AI_GATEWAY_API_KEY as a gateway credential', () => {
    process.env.AI_GATEWAY_API_KEY = 'gateway-key';
    delete process.env.VERCEL_TOKEN;

    assert.equal(resolveGatewayApiKey(), 'gateway-key');
    assert.equal(hasGatewayCredentials(), true);
    assert.equal(hasCloudCredentials(), true);
    assert.equal(getVercelTokenMisconfiguration(), undefined);
  });

  it('does not treat VERCEL_TOKEN as a gateway credential', () => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.OPENAI_API_KEY;
    process.env.VERCEL_TOKEN = 'vercel-cli-token';

    assert.equal(resolveGatewayApiKey(), undefined);
    assert.equal(hasGatewayCredentials(), false);
    assert.equal(hasCloudCredentials(), false);
    assert.match(getVercelTokenMisconfiguration() || '', /AI_GATEWAY_API_KEY/);
  });
});
