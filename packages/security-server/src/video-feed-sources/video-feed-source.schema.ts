import { z } from 'zod';
import { RtspConfigSchema, UsbConfigSchema } from './video-feed-source-config.schema';

export const CreateVideoFeedSourceSchema = z.discriminatedUnion('type', [
  z.object({ name: z.string().min(1), type: z.literal('RTSP'), config: RtspConfigSchema, enabled: z.boolean().optional() }),
  z.object({ name: z.string().min(1), type: z.literal('USB'), config: UsbConfigSchema, enabled: z.boolean().optional() }),
]);
export type CreateVideoFeedSourceDto = z.infer<typeof CreateVideoFeedSourceSchema>;

// type is intentionally not editable here — changing RTSP<->USB changes the config shape
// entirely, so that's a delete-and-recreate rather than an in-place update.
export const UpdateVideoFeedSourceSchema = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  similarityThreshold: z.number().min(0).max(1).nullable().optional(),
  recognitionFps: z.number().min(0.1).max(30).optional(),
});
export type UpdateVideoFeedSourceDto = z.infer<typeof UpdateVideoFeedSourceSchema>;

// Connection details straight from the add/edit form, verified before they're saved. channelId
// (when editing) lets blank/redacted credentials fall back to the stored ones.
export const VerifyVideoFeedSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RTSP'), config: z.record(z.string(), z.unknown()), channelId: z.string().optional() }),
  z.object({ type: z.literal('USB'), config: z.record(z.string(), z.unknown()), channelId: z.string().optional() }),
]);
export type VerifyVideoFeedSourceDto = z.infer<typeof VerifyVideoFeedSourceSchema>;
