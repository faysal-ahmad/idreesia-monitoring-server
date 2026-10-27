import { api } from './client';
import {
  ImageUploadResult,
  MonitoringProfileDetail,
  MonitoringProfileSummary,
} from './types';

export interface CreateMonitoringProfileInput {
  name: string;
  isTest?: boolean;
}

export interface UpdateMonitoringProfileInput {
  name?: string;
  isTest?: boolean;
}

export const monitoringProfilesApi = {
  list: () => api.get<MonitoringProfileSummary[]>('/monitoring-profiles'),
  get: (id: string) =>
    api.get<MonitoringProfileDetail>(`/monitoring-profiles/${id}`),
  create: (input: CreateMonitoringProfileInput) =>
    api.post<MonitoringProfileSummary>('/monitoring-profiles', input),
  update: (id: string, input: UpdateMonitoringProfileInput) =>
    api.patch<MonitoringProfileSummary>(`/monitoring-profiles/${id}`, input),
  remove: (id: string) => api.delete<void>(`/monitoring-profiles/${id}`),
  addImage: (id: string, file: File, acknowledgeWarning: boolean) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('acknowledgeWarning', String(acknowledgeWarning));
    return api.postForm<ImageUploadResult>(
      `/monitoring-profiles/${id}/images`,
      formData,
    );
  },
  removeImage: (id: string, imageId: string) =>
    api.delete<void>(`/monitoring-profiles/${id}/images/${imageId}`),
  recalculateQuality: (id: string) =>
    api.post<{ recalculated: number; notRated: number }>(
      `/monitoring-profiles/${id}/images/recalculate-quality`,
    ),
};
