import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NameThisEngine } from '../src/engine.js';

describe('NameThisEngine routing', () => {
  it('initializes ModelHitch with autoMode instead of custom provider lanes', async () => {
    const engine = new NameThisEngine();
    const hitch = await engine.getModelHitch();

    assert.equal(hitch.autoMode, true);
    assert.equal(hitch.policy, undefined);
  });

  it('does not add custom ollama lanes to autoMode', async () => {
    const engine = new NameThisEngine();
    const hitch = await engine.getModelHitch();
    const autoMode = hitch.autoMode;

    if (typeof autoMode === 'object' && autoMode?.lanes) {
      assert.ok(!autoMode.lanes.some((lane) => lane.providerId === 'ollama'));
    } else {
      assert.equal(autoMode, true);
    }
  });

  it('lists providers from the ModelHitch registry', async () => {
    const engine = new NameThisEngine();
    const providers = await engine.listProviders();

    assert.ok(providers.length > 0);
    assert.ok(providers.some((provider) => provider.id === 'vercel-ai-gateway'));
  });
});
