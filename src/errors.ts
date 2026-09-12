import { isExhaustedError, type LaneAttempt } from 'modelhitch';

export interface FormattedFailure {
  message: string;
  hint?: string;
}

function isContextOverflowAttempt(attempt: LaneAttempt): boolean {
  const haystack = `${attempt.error.code} ${attempt.error.message}`.toLowerCase();
  return (
    haystack.includes('context size') ||
    haystack.includes('context window') ||
    haystack.includes('exceeds the available context') ||
    haystack.includes('maximum context length')
  );
}

function isCredentialAttempt(attempt: LaneAttempt): boolean {
  return attempt.error.code === 'invalid-api-key' || attempt.error.code === 'missing-api-key';
}

export function formatGenerationFailure(err: unknown): FormattedFailure {
  if (isExhaustedError(err)) {
    const attempts = err.info.attempts;
    const contextOverflow = attempts.some(isContextOverflowAttempt);
    const credentialFailures = attempts.filter(isCredentialAttempt);
    const allCredentialFailures =
      attempts.length > 0 && credentialFailures.length === attempts.length;

    if (contextOverflow) {
      const overflowLane = attempts.find(isContextOverflowAttempt);
      const lane = overflowLane
        ? `${overflowLane.target.providerId}/${overflowLane.target.model}`
        : 'the selected model';
      return {
        message: `Project scan context exceeded ${lane}'s context window.`,
        hint:
          'Retry without --crawl, use a smaller repo path, or set -m to a cloud model with a larger context window. Local 4k models (for example deepseek-r1:7b) need a compact scan.',
      };
    }

    if (allCredentialFailures) {
      return {
        message: 'No valid AI credentials were accepted by any provider lane.',
        hint:
          'Set AI_GATEWAY_API_KEY (https://vercel.com/ai-gateway), pass --key with your gateway key, or ensure local Ollama is running with a model that fits the scan context.',
      };
    }

    const last = attempts[attempts.length - 1];
    if (last) {
      return {
        message: `${last.target.providerId}/${last.target.model}: ${last.error.message}`,
        hint:
          'Check credentials for cloud models or reduce scan size for local models. Run `namethis models` to verify provider availability.',
      };
    }
  }

  if (err instanceof Error) {
    const message = err.message;
    if (/context size|context window|exceeds the available context/i.test(message)) {
      return {
        message: 'Project scan context exceeded the model context window.',
        hint: 'Retry without --crawl or choose a model with a larger context window.',
      };
    }
    if (/invalid-api-key|missing-api-key|rejected the api key/i.test(message)) {
      return {
        message,
        hint:
          'Set AI_GATEWAY_API_KEY, pass --key with the same gateway key you use elsewhere, or use a local Ollama model.',
      };
    }
    return { message };
  }

  return { message: String(err) };
}
