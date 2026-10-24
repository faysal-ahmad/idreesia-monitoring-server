import { z } from 'zod';

// Query-string params arrive as strings, hence the coercion.
export const ListSystemLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListSystemLogsQuery = z.infer<typeof ListSystemLogsQuerySchema>;
