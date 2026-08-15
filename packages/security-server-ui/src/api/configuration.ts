import { api } from './client';
import { Configuration } from './types';

export interface UpdateConfigurationInput {
  alertsRetentionDays: number;
}

export const configurationApi = {
  get: () => api.get<Configuration>('/configuration'),
  update: (input: UpdateConfigurationInput) => api.patch<Configuration>('/configuration', input),
};
