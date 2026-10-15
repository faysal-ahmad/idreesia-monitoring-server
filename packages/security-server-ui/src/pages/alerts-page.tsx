import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Image,
  Pagination,
  Progress,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { alertsApi } from '../api/alerts';
import { Alert } from '../api/types';
import { AlertImagesModal } from '../components/alert-images-modal';

const { Text, Title } = Typography;

const REFRESH_INTERVAL_MS = 3000;

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function AlertsPage() {
  const [isPaused, setIsPaused] = useState(false);
  const {
    data: alerts,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['alerts'],
    queryFn: alertsApi.list,
    refetchInterval: isPaused ? false : REFRESH_INTERVAL_MS,
  });
  const [now, setNow] = useState(() => Date.now());
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Ticks every second so the "updated Xs ago" label stays current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
          Alerts
        </Title>
        <Space>
          {dataUpdatedAt > 0 && (
            <Text type="secondary">
              updated {formatElapsed(now - dataUpdatedAt)}
            </Text>
          )}
          <Button
            icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={() => setIsPaused((paused) => !paused)}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
          {isPaused && (
            <Tooltip title="Refresh">
              <Button
                icon={<ReloadOutlined />}
                loading={isFetching}
                onClick={() => refetch()}
              />
            </Tooltip>
          )}
        </Space>
      </Space>
      <div className="list-container">
        <Table
          className="list-table"
          bordered
          size="middle"
          rowKey="id"
          onRow={(record) => ({
            onClick: () => setSelectedAlert(record),
            style: { cursor: 'pointer' },
          })}
          loading={isLoading}
          dataSource={(alerts ?? []).slice(
            (page - 1) * pageSize,
            page * pageSize,
          )}
          pagination={false}
          footer={() => (
            <Pagination
              current={page}
              pageSize={pageSize}
              total={alerts?.length ?? 0}
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
              title: 'Frame',
              render: (_, record: Alert) => (
                <Image
                  src={`/api/alerts/${record.id}/image`}
                  width={64}
                  height={64}
                  preview={false}
                  style={{ objectFit: 'cover' }}
                />
              ),
            },
            { title: 'Monitored Person', dataIndex: ['profile', 'name'] },
            { title: 'Channel', dataIndex: ['channel', 'name'] },
            {
              title: 'Confidence',
              dataIndex: 'similarityScore',
              render: (score: number) => (
                <Progress
                  percent={Math.round(score * 100)}
                  size="small"
                  style={{ width: 120 }}
                />
              ),
            },
            {
              title: 'Detected At',
              dataIndex: 'timestamp',
              render: (timestamp: string) =>
                new Date(timestamp).toLocaleString(),
            },
          ]}
          locale={{ emptyText: 'No alerts yet.' }}
        />
      </div>
      <AlertImagesModal
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
      />
    </div>
  );
}
