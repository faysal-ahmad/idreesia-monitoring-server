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

// Accepts either a numeric device index or a device path (e.g. "/dev/video0") —
// whichever the host/OS exposes for a given USB camera.
export const UsbConfigSchema = z.object({
  deviceIndex: z.union([z.number().int().min(0), z.string().min(1)]),
});

export type RtspConfig = z.infer<typeof RtspConfigSchema>;
export type UsbConfig = z.infer<typeof UsbConfigSchema>;
export type VideoFeedSourceConfig = RtspConfig | UsbConfig;

export function parseVideoFeedSourceConfig(type: 'RTSP' | 'USB', config: unknown): VideoFeedSourceConfig {
  return type === 'RTSP' ? RtspConfigSchema.parse(config) : UsbConfigSchema.parse(config);
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
