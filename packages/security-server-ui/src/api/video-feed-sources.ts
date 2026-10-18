import { api } from './client';
import { RtspConfig, TestMatchResult, UsbConfig, VerifyResult, VideoFeedSource, VideoFeedSourceType } from './types';

export interface CreateVideoFeedSourceInput {
  name: string;
  type: VideoFeedSourceType;
  config: RtspConfig | UsbConfig;
  enabled?: boolean;
}

export interface UpdateVideoFeedSourceInput {
  name?: string;
  config?: Partial<RtspConfig> & Partial<UsbConfig>;
  enabled?: boolean;
  similarityThreshold?: number | null;
  recognitionFps?: number;
}

// channelId (when editing) lets blank/redacted credentials fall back to the stored ones.
export interface VerifyVideoFeedSourceInput {
  type: VideoFeedSourceType;
  config: RtspConfig | UsbConfig;
  channelId?: string;
}

export const videoFeedSourcesApi = {
  list: () => api.get<VideoFeedSource[]>('/video-feed-sources'),
  get: (id: string) => api.get<VideoFeedSource>(`/video-feed-sources/${id}`),
  create: (input: CreateVideoFeedSourceInput) => api.post<VideoFeedSource>('/video-feed-sources', input),
  update: (id: string, input: UpdateVideoFeedSourceInput) =>
    api.patch<VideoFeedSource>(`/video-feed-sources/${id}`, input),
  remove: (id: string) => api.delete<void>(`/video-feed-sources/${id}`),
  verify: (input: VerifyVideoFeedSourceInput) => api.post<VerifyResult>('/video-feed-sources/verify', input),
  testMatch: (id: string) => api.post<TestMatchResult>(`/video-feed-sources/${id}/test-match`),
};
