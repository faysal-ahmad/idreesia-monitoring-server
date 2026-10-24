import { api } from './client';
import { SystemLogPage } from './types';

export interface ListSystemLogsParams {
  page: number;
  pageSize: number;
}

export const systemLogsApi = {
  list: ({ page, pageSize }: ListSystemLogsParams) =>
    api.get<SystemLogPage>(
      `/system-logs?${new URLSearchParams({ page: String(page), pageSize: String(pageSize) })}`,
    ),
};
