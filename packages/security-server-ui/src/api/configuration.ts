import { api } from './client';
import { Configuration } from './types';

export interface UpdateConfigurationInput {
  alertsRetentionDays?: number;
  includeTestProfilesInAlerts?: boolean;
  erpSyncIntervalMinutes?: number;
  erpAlertRetryIntervalMinutes?: number;
}

export const configurationApi = {
  get: () => api.get<Configuration>('/configuration'),
  update: (input: UpdateConfigurationInput) =>
    api.patch<Configuration>('/configuration', input),
};
