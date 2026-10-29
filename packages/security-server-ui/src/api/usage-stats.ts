import { api } from './client';
import { UsageStatsSummary } from './types';

export const usageStatsApi = {
  get: (minutes: number) =>
    api.get<UsageStatsSummary>(`/usage-stats?minutes=${minutes}`),
};
