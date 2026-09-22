import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  buildCooldownFromConfig,
  isMaskedSecret,
  MemoryKeyStore,
  type ModelHitchConfig,
  type ModelHitchOptions,
  type Policy,
  readConfigFile,
} from 'modelhitch';

function usablePolicy(hitchConfig: ModelHitchConfig | null | undefined): Policy | null {
  const policy = hitchConfig?.policy;
  if (!policy) return null;
  const trusted = Array.isArray(policy.trusted) ? policy.trusted : [];
  const fallback = Array.isArray(policy.fallback) ? policy.fallback : [];
  if (trusted.length + fallback.length === 0) return null;
  return { ...policy, trusted, fallback };
}

export function modelhitchConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  const home = environment.MODELHITCH_HOME || join(homedir(), '.modelhitch');
  return join(home, 'config.json');
}

export function loadModelHitchUserConfig(
  environment: NodeJS.ProcessEnv = process.env
): ModelHitchConfig | null {
  try {
    return readConfigFile(modelhitchConfigPath(environment));
  } catch {
    return null;
  }
}

/** Match Dirgest: ~/.modelhitch policy when present, otherwise ModelHitch autoMode. */
export async function buildModelHitchClientOptions(
  hitchConfig: ModelHitchConfig | null = loadModelHitchUserConfig()
): Promise<ModelHitchOptions> {
  const keystore = new MemoryKeyStore();
  for (const [providerId, apiKey] of Object.entries(hitchConfig?.keys || {})) {
    if (typeof apiKey === 'string' && apiKey.trim() && !isMaskedSecret(apiKey)) {
      await keystore.set(providerId, apiKey);
    }
  }

  const policy = usablePolicy(hitchConfig);
  const options: ModelHitchOptions = { keystore };

  if (hitchConfig?.defaultProviderId) {
    options.defaultProviderId = hitchConfig.defaultProviderId;
  }
  if (hitchConfig?.defaultModel) {
    options.defaultModel = hitchConfig.defaultModel;
  }

  if (policy) {
    options.policy = policy;
    try {
      const cooldown = hitchConfig ? buildCooldownFromConfig(hitchConfig) : undefined;
      if (cooldown) options.cooldown = cooldown;
    } catch {
      // Registry autoMode still works if a config cooldown section is incomplete.
    }
    return options;
  }

  options.autoMode = true;
  return options;
}
