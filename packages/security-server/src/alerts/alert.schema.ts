import { z } from 'zod';

// null clears a previous review.
export const ReviewAlertSchema = z.object({
  review: z.enum(['CORRECT', 'FALSE_POSITIVE']).nullable(),
});
export type ReviewAlertDto = z.infer<typeof ReviewAlertSchema>;
