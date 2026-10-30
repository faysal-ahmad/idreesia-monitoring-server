import { api } from './client';
import { Configuration } from './types';

export interface UpdateConfigurationInput {
  alertsRetentionDays?: number;
  usageStatsIntervalSeconds?: number;
  usageStatsRetentionDays?: number;
  includeTestProfilesInAlerts?: boolean;
  erpUrl?: string;
  erpUsername?: string;
  // Blank keeps the stored password.
  erpPassword?: string;
  erpSyncIntervalMinutes?: number;
  erpAlertRetryIntervalMinutes?: number;
}

export const configurationApi = {
  get: () => api.get<Configuration>('/configuration'),
  update: (input: UpdateConfigurationInput) =>
    api.patch<Configuration>('/configuration', input),
};
