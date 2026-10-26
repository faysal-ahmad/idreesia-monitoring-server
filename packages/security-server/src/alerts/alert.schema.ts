import { z } from 'zod';

// Query-string params arrive as strings, hence the coercion.
export const ListAlertsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  profileId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  // ISO timestamps; either end may be left open.
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  hideTestProfiles: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListAlertsQuery = z.infer<typeof ListAlertsQuerySchema>;
