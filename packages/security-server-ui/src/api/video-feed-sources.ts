import { api } from './client';
import {
  FrameAnalysis,
  RtspConfig,
  TestMatchResult,
  VerifyResult,
  VideoFeedSource,
} from './types';

export interface CreateVideoFeedSourceInput {
  name: string;
  config: RtspConfig;
  enabled?: boolean;
}

export interface UpdateVideoFeedSourceInput {
  name?: string;
  config?: Partial<RtspConfig>;
  enabled?: boolean;
  similarityThreshold?: number | null;
  recognitionFps?: number;
  minFaceSizePx?: number | null;
  minFaceQuality?: number | null;
}

// channelId (when editing) lets blank/redacted credentials fall back to the stored ones.
export interface VerifyVideoFeedSourceInput {
  config: RtspConfig;
  channelId?: string;
}

export const videoFeedSourcesApi = {
  list: () => api.get<VideoFeedSource[]>('/video-feed-sources'),
  get: (id: string) => api.get<VideoFeedSource>(`/video-feed-sources/${id}`),
  create: (input: CreateVideoFeedSourceInput) =>
    api.post<VideoFeedSource>('/video-feed-sources', input),
  update: (id: string, input: UpdateVideoFeedSourceInput) =>
    api.patch<VideoFeedSource>(`/video-feed-sources/${id}`, input),
  remove: (id: string) => api.delete<void>(`/video-feed-sources/${id}`),
  verify: (input: VerifyVideoFeedSourceInput) =>
    api.post<VerifyResult>('/video-feed-sources/verify', input),
  testMatch: (id: string) =>
    api.post<TestMatchResult>(`/video-feed-sources/${id}/test-match`),
  analyzeFrame: (id: string, frame: Blob) => {
    const formData = new FormData();
    formData.append('file', frame, 'frame.jpg');
    return api.postForm<FrameAnalysis>(
      `/video-feed-sources/${id}/analyze-frame`,
      formData,
    );
  },
};
