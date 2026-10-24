import { api } from './client';
import { AlertFilterOptions, AlertPage, AlertReview } from './types';

export interface ListAlertsParams {
  page: number;
  pageSize: number;
  profileId?: string;
  channelId?: string;
  // ISO timestamps; either end may be left open.
  from?: string;
  to?: string;
  hideTestProfiles?: boolean;
}

function toQueryString({
  page,
  pageSize,
  profileId,
  channelId,
  from,
  to,
  hideTestProfiles,
}: ListAlertsParams) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (profileId) params.set('profileId', profileId);
  if (channelId) params.set('channelId', channelId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
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
