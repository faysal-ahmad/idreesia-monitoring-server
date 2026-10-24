import { ReloadOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Button,
  Pagination,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { systemLogsApi } from '../api/system-logs';
import { SystemLog, SystemLogEvent, SystemLogSource } from '../api/types';

const { Title } = Typography;

const EVENT_TAGS: Record<SystemLogEvent, { color: string; label: string }> = {
  CHANNEL_CREATED: { color: 'green', label: 'Channel created' },
  CHANNEL_UPDATED: { color: 'blue', label: 'Channel edited' },
  CHANNEL_DELETED: { color: 'default', label: 'Channel deleted' },
  CHANNEL_ENABLED: { color: 'cyan', label: 'Channel enabled' },
  CHANNEL_DISABLED: { color: 'red', label: 'Channel disabled' },
};

// SYSTEM entries are the server acting on its own, e.g. disabling a channel whose camera stayed
// unreachable — highlighted so they stand out from admin changes.
const SOURCE_TAGS: Record<SystemLogSource, { color: string; label: string }> = {
  ADMIN: { color: 'default', label: 'Admin' },
  SYSTEM: { color: 'orange', label: 'System' },
};

export default function SystemLogsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const {
    data: logPage,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['system-logs', { page, pageSize }],
    queryFn: () => systemLogsApi.list({ page, pageSize }),
    // Keeps the current rows on screen while the next page loads, instead of flashing empty.
    placeholderData: keepPreviousData,
  });

  // A page can end up past the end (e.g. after a page size change) — go to the last one.
  useEffect(() => {
    if (!logPage || logPage.data.length > 0 || page === 1) return;
    if (logPage.total > 0) setPage(Math.ceil(logPage.total / pageSize));
  }, [logPage, page, pageSize]);

  return (
    <div>
      <Space
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          System Logs
        </Title>
        <Tooltip title="Refresh">
          <Button
            icon={<ReloadOutlined />}
            loading={isFetching}
            onClick={() => refetch()}
          />
        </Tooltip>
      </Space>

      <div className="list-container">
        <Table
          className="list-table"
          bordered
          size="middle"
          rowKey="id"
          loading={isLoading}
          dataSource={logPage?.data ?? []}
          pagination={false}
          footer={() => (
            <Pagination
              current={page}
              pageSize={pageSize}
              total={logPage?.total ?? 0}
              showSizeChanger
              showTotal={(total, range) =>
                `${range[0]}-${range[1]} of ${total} items`
              }
              onChange={(nextPage, nextPageSize) => {
                setPage(nextPage);
                setPageSize(nextPageSize);
              }}
            />
          )}
          columns={[
            {
              title: 'Time',
              dataIndex: 'timestamp',
              width: 200,
              render: (timestamp: string) =>
                new Date(timestamp).toLocaleString(),
            },
            {
              title: 'Event',
              dataIndex: 'event',
              width: 170,
              render: (event: SystemLogEvent) => (
                <Tag color={EVENT_TAGS[event].color}>
                  {EVENT_TAGS[event].label}
                </Tag>
              ),
            },
            {
              title: 'Source',
              dataIndex: 'source',
              width: 100,
              render: (source: SystemLogSource) => (
                <Tag color={SOURCE_TAGS[source].color}>
                  {SOURCE_TAGS[source].label}
                </Tag>
              ),
            },
            {
              title: 'Channel',
              dataIndex: 'channelName',
              width: 180,
              render: (name: SystemLog['channelName']) => name ?? '—',
            },
            { title: 'Details', dataIndex: 'message' },
          ]}
          locale={{ emptyText: 'No log entries yet.' }}
        />
      </div>
    </div>
  );
}
