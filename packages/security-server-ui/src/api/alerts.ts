import { api } from './client';
import { Alert, AlertReview } from './types';

export const alertsApi = {
  list: () => api.get<Alert[]>('/alerts'),
  review: (id: string, review: AlertReview | null) =>
    api.patch<void>(`/alerts/${id}/review`, { review }),
};
