import { z } from 'zod';

// Query-string params arrive as strings, hence the coercion. Capped at a week (10080 minutes), the
// default usageStatsRetentionDays; older rows are usually purged anyway.
export const UsageStatsQuerySchema = z.object({
  minutes: z.coerce.number().int().min(1).max(10080).default(60),
});
export type UsageStatsQuery = z.infer<typeof UsageStatsQuerySchema>;
