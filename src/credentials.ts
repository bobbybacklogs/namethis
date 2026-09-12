import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Provider } from 'modelhitch';

const APP_DIR = 'com.vercel.cli';
const AUTH_FILE = 'auth.json';

/**
 * Candidate auth.json paths, including the Windows Vercel CLI location
 * `%APPDATA%\\xdg.data\\com.vercel.cli` (APPDATA is already Roaming).
 */
function vercelCliAuthPaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [];
  const push = (dir: string) => {
    paths.push(path.join(dir, AUTH_FILE));
    paths.push(path.join(dir, 'Data', AUTH_FILE));
  };

  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) push(path.join(xdg, APP_DIR));

  push(path.join(home, '.local', 'share', APP_DIR));
  push(path.join(home, 'Library', 'Application Support', APP_DIR));

  const appData = process.env.APPDATA;
  if (appData) {
    push(path.join(appData, APP_DIR));
    push(path.join(appData, 'xdg.data', APP_DIR));
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    push(path.join(localAppData, APP_DIR));
    push(path.join(localAppData, 'xdg.data', APP_DIR));
  }

  paths.push(path.join(home, '.now', AUTH_FILE));
  return [...new Set(paths)];
}

export function readVercelCliAuthToken(): string | undefined {
  if (process.env.MODELHITCH_SKIP_VERCEL_CLI_AUTH === '1') return undefined;
  for (const candidate of vercelCliAuthPaths()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { token?: unknown };
      if (typeof parsed.token === 'string' && parsed.token.trim()) {
        return parsed.token.trim();
      }
    } catch {
      // try next path
    }
  }
  return undefined;
}

/** Only pass keys the user supplied explicitly (for example via --key). */
export function resolveExplicitApiKey(explicit?: string): string | undefined {
  const trimmed = explicit?.trim();
  return trimmed ? trimmed : undefined;
}

type ProviderCredentialFields = Provider & {
  apiKeyEnvVar?: string;
  apiKeyEnvFallbacks?: string[];
  config?: {
    apiKeyEnvVar?: string;
    apiKeyEnvFallbacks?: string[];
  };
};

/**
 * ModelHitch V2 keeps OpenAI-compatible credential env names on the private
 * `config` object; other providers expose them directly (same as Dirgest).
 */
export function providerCredentialEnvNames(provider: Provider): string[] {
  const fields = provider as ProviderCredentialFields;
  const primary = fields.apiKeyEnvVar ?? fields.config?.apiKeyEnvVar;
  const fallbacks = fields.apiKeyEnvFallbacks ?? fields.config?.apiKeyEnvFallbacks ?? [];
  return [primary, ...fallbacks].filter((name): name is string => Boolean(name));
}

export function hasConfiguredProviderCredential(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return providerCredentialEnvNames(provider).some((name) => Boolean(env[name]?.trim()));
}

export function findConfiguredProvider(providers: Provider[]): Provider | undefined {
  return providers.find((provider) => hasConfiguredProviderCredential(provider));
}

export function hasCloudCredentials(
  explicit?: string,
  providers: Provider[] = []
): boolean {
  if (resolveExplicitApiKey(explicit)) return true;
  if (providers.some((provider) => hasConfiguredProviderCredential(provider))) return true;
  return Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() ||
      process.env.VERCEL_OIDC_TOKEN?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.VERCEL_TOKEN?.trim() ||
      readVercelCliAuthToken()
  );
}
