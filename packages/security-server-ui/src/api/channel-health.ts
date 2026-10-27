import { api } from './client';
import { ChannelHealth } from './types';

export const channelHealthApi = {
  list: () => api.get<ChannelHealth[]>('/channel-health'),
};
