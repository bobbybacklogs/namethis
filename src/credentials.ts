/** Only pass keys the user supplied explicitly (for example via --key). */
export function resolveExplicitApiKey(explicit?: string): string | undefined {
  const trimmed = explicit?.trim();
  return trimmed ? trimmed : undefined;
}
