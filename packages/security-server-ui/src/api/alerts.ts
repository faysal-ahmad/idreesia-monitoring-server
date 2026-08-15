import { api } from './client';
import { Alert } from './types';

export const alertsApi = {
  list: () => api.get<Alert[]>('/alerts'),
};
