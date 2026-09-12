export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const SMALL_CONTEXT_WINDOW = 4096;
export const DEFAULT_CONTEXT_WINDOW = 32768;

const RESERVED_TOKENS_SMALL = 1800;
const RESERVED_TOKENS_DEFAULT = 2500;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function resolveContextWindow(providerId: string, model?: string): number {
  if (providerId !== 'ollama') return DEFAULT_CONTEXT_WINDOW;

  const normalized = (model || '').toLowerCase();
  if (normalized.includes('deepseek-r1') || normalized.includes(':7b') || normalized.includes('7b')) {
    return SMALL_CONTEXT_WINDOW;
  }
  if (normalized.includes('llama3.2') || normalized.includes('llama3.1')) {
    return 8192;
  }
  return SMALL_CONTEXT_WINDOW;
}

export function scanCharBudget(providerId: string, model?: string): number {
  const window = resolveContextWindow(providerId, model);
  const reserved = window <= SMALL_CONTEXT_WINDOW ? RESERVED_TOKENS_SMALL : RESERVED_TOKENS_DEFAULT;
  const availableTokens = Math.max(window - reserved, 256);
  return availableTokens * CHARS_PER_TOKEN_ESTIMATE;
}

export function truncateToCharBudget(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;

  const notice = '\n\n[context truncated for model context limits]';
  const sliceEnd = Math.max(0, maxChars - notice.length);
  return `${text.slice(0, sliceEnd).trimEnd()}${notice}`;
}

export function estimatePromptTokens(parts: {
  systemInstructions: string;
  promptTemplate: string;
  scannedContext: string;
}): number {
  return estimateTokens(
    `${parts.systemInstructions}\n${parts.promptTemplate}\n${parts.scannedContext}`
  );
}
