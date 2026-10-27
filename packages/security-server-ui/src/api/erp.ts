import { api } from './client';
import { ErpStatus, ErpSyncSummary } from './types';

export const erpApi = {
  status: () => api.get<ErpStatus>('/erp/status'),
  // The full two-way sync, straight away.
  sync: () => api.post<ErpSyncSummary>('/erp/sync'),
};
