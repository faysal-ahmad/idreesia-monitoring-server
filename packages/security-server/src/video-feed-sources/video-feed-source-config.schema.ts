import { z } from 'zod';

// Decomposed RTSP fields (rather than one raw URL) so credentials live under known,
// redactable keys — see redactConfig below — instead of being embedded in a URL string.
export const RtspConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(554),
  path: z.string().default(''),
  username: z.string().optional(),
  password: z.string().optional(),
});

export type RtspConfig = z.infer<typeof RtspConfigSchema>;

export function parseRtspConfig(config: unknown): RtspConfig {
  return RtspConfigSchema.parse(config);
}

const REDACTED_KEYS = ['username', 'password'];
const REDACTED_PLACEHOLDER = '••••••';

// Credentials live inside the config JSONB blob, not a dedicated column — redaction has to
// strip specific known keys out of the JSON rather than exclude a column.
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...config };
  for (const key of REDACTED_KEYS) {
    if (redacted[key] != null) redacted[key] = REDACTED_PLACEHOLDER;
  }
  return redacted;
}

// The edit form only ever sees redacted credentials, so it sends them back as the placeholder
// (username) or blank ("leave blank to keep current" password). Both mean "keep the stored
// value" — without this, saving or verifying an edited channel would wipe its credentials.
export function mergeStoredCredentials(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...incoming };
  if (merged.username === REDACTED_PLACEHOLDER) merged.username = stored.username;
  if (merged.password == null || merged.password === '' || merged.password === REDACTED_PLACEHOLDER) {
    merged.password = stored.password;
  }
  return merged;
}
