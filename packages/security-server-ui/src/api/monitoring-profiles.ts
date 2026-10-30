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

// An <img> URL, not a fetch: the browser sends the admin session cookie with it.
export const profileThumbnailUrl = (profileId: string, imageId: string) =>
  `/api/monitoring-profiles/${profileId}/images/${imageId}/thumbnail`;

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
  setDefaultImage: (id: string, imageId: string) =>
    api.post<void>(`/monitoring-profiles/${id}/images/${imageId}/default`),
  removeImage: (id: string, imageId: string) =>
    api.delete<void>(`/monitoring-profiles/${id}/images/${imageId}`),
};
