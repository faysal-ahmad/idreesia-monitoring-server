import { z } from 'zod';

export const UpdateConfigurationSchema = z.object({
  alertsRetentionDays: z.number().int().min(1).optional(),
  includeTestProfilesInAlerts: z.boolean().optional(),
});
export type UpdateConfigurationDto = z.infer<typeof UpdateConfigurationSchema>;
