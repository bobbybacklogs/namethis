import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

/** Credentials accepted by Vercel AI Gateway as Bearer tokens. */
export function resolveGatewayApiKey(explicit?: string): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return process.env.AI_GATEWAY_API_KEY.trim();
  if (process.env.VERCEL_OIDC_TOKEN?.trim()) return process.env.VERCEL_OIDC_TOKEN.trim();
  return undefined;
}

/** Direct OpenAI key used by the OpenAI failover lane. */
export function resolveDirectOpenAIApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

/**
 * Legacy helper retained for callers that need any cloud-ish credential.
 * Prefer resolveGatewayApiKey / resolveDirectOpenAIApiKey for routing.
 */
export function resolveCloudApiKey(explicit?: string): string | undefined {
  return resolveGatewayApiKey(explicit) || resolveDirectOpenAIApiKey();
}

export function hasGatewayCredentials(explicit?: string): boolean {
  return Boolean(resolveGatewayApiKey(explicit));
}

export function hasDirectOpenAICredentials(): boolean {
  return Boolean(resolveDirectOpenAIApiKey());
}

export function hasCloudCredentials(explicit?: string): boolean {
  return hasGatewayCredentials(explicit) || hasDirectOpenAICredentials();
}

export function hasVercelCliToken(): boolean {
  return Boolean(process.env.VERCEL_TOKEN?.trim() || readVercelCliAuthToken());
}

/** Explain the common `vercel login` vs AI Gateway key mismatch. */
export function getVercelTokenMisconfiguration(): string | undefined {
  if (hasGatewayCredentials() || hasDirectOpenAICredentials()) return undefined;
  if (!hasVercelCliToken()) return undefined;
  return 'Found a Vercel CLI token, but AI Gateway requires AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN). `vercel login` alone is not enough for cloud model calls.';
}
