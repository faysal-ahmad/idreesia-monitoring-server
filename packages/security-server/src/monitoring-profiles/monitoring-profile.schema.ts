import { z } from 'zod';

export const CreateMonitoringProfileSchema = z.object({
  name: z.string().min(1),
  isTest: z.boolean().optional(),
});
export type CreateMonitoringProfileDto = z.infer<typeof CreateMonitoringProfileSchema>;

export const UpdateMonitoringProfileSchema = z.object({
  name: z.string().min(1).optional(),
  isTest: z.boolean().optional(),
});
export type UpdateMonitoringProfileDto = z.infer<typeof UpdateMonitoringProfileSchema>;
