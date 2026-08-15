import { ReloadOutlined } from '@ant-design/icons';
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
import { useState } from 'react';
import { alertsApi } from '../api/alerts';
import { Alert } from '../api/types';

const { Title } = Typography;

export default function AlertsPage() {
  const {
    data: alerts,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['alerts'],
    queryFn: alertsApi.list,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

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
    </div>
  );
}
