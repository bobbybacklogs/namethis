export function processWebhookPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}
