import { z } from 'zod';

export const UpdateConfigurationSchema = z.object({
  alertsRetentionDays: z.number().int().min(1),
});
export type UpdateConfigurationDto = z.infer<typeof UpdateConfigurationSchema>;
