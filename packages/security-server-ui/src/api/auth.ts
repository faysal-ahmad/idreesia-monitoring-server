import { api } from './client';
import { AuthSession } from './types';

export const SESSION_QUERY_KEY = ['auth', 'session'];

export const authApi = {
  session: () => api.get<AuthSession>('/auth/session'),
  login: (password: string) => api.post<void>('/auth/login', { password }),
  logout: () => api.post<void>('/auth/logout'),
};
