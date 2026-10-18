import { api } from './client';
import { AlertFilterOptions, AlertPage, AlertReview } from './types';

export interface ListAlertsParams {
  page: number;
  pageSize: number;
  profileId?: string;
  channelId?: string;
  hideTestProfiles?: boolean;
}

function toQueryString({
  page,
  pageSize,
  profileId,
  channelId,
  hideTestProfiles,
}: ListAlertsParams) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (profileId) params.set('profileId', profileId);
  if (channelId) params.set('channelId', channelId);
  if (hideTestProfiles) params.set('hideTestProfiles', 'true');
  return params.toString();
}

export const alertsApi = {
  list: (params: ListAlertsParams) =>
    api.get<AlertPage>(`/alerts?${toQueryString(params)}`),
  filterOptions: () => api.get<AlertFilterOptions>('/alerts/filter-options'),
  review: (id: string, review: AlertReview | null) =>
    api.patch<void>(`/alerts/${id}/review`, { review }),
};
