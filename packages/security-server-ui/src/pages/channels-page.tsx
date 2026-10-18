import {
  CheckCircleOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Image,
  Pagination,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useState } from 'react';
import {
  ChannelFormModal,
  ChannelFormValues,
} from '../components/channel-form-modal';
import { TestMatchModal } from '../components/test-match-modal';
import { videoFeedSourcesApi } from '../api/video-feed-sources';
import { VideoFeedSource } from '../api/types';

const { Title, Link } = Typography;

function toApiInput(values: ChannelFormValues) {
  const config =
    values.type === 'RTSP'
      ? {
          host: values.host!,
          port: values.port!,
          path: values.path ?? '',
          username: values.username,
          password: values.password,
        }
      : {
          deviceIndex:
            values.deviceIndex && /^\d+$/.test(values.deviceIndex)
              ? Number(values.deviceIndex)
              : values.deviceIndex!,
        };
  return {
    name: values.name,
    type: values.type,
    enabled: values.enabled,
    config,
  };
}

export default function ChannelsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<VideoFeedSource | null>(
    null,
  );
  const [testMatchChannel, setTestMatchChannel] =
    useState<VideoFeedSource | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const {
    data: channels,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['video-feed-sources'],
    queryFn: videoFeedSourcesApi.list,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['video-feed-sources'] });

  const createMutation = useMutation({
    mutationFn: videoFeedSourcesApi.create,
    onSuccess: () => {
      message.success('Channel created');
      setFormOpen(false);
      invalidate();
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to create channel',
      ),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: ReturnType<typeof toApiInput> & {
        similarityThreshold: number | null;
      };
    }) => videoFeedSourcesApi.update(id, input),
    onSuccess: () => {
      message.success('Channel updated');
      setFormOpen(false);
      setEditingChannel(null);
      invalidate();
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to update channel',
      ),
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      videoFeedSourcesApi.update(id, { enabled }),
    onSuccess: (_, { enabled }) => {
      message.success(enabled ? 'Channel enabled' : 'Channel disabled');
      invalidate();
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to update channel',
      ),
  });

  const removeMutation = useMutation({
    mutationFn: videoFeedSourcesApi.remove,
    onSuccess: () => {
      message.success('Channel deleted');
      invalidate();
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to delete channel',
      ),
  });

  const verifyMutation = useMutation({
    mutationFn: videoFeedSourcesApi.verify,
    onSuccess: (result) => {
      if (result.reachable) {
        message.success('Channel is reachable');
        if (result.previewImage) setPreviewImage(result.previewImage);
      } else {
        message.error(result.error ?? 'Channel is not reachable');
      }
    },
    onError: (error) =>
      message.error(error instanceof Error ? error.message : 'Verify failed'),
  });

  const handleSubmit = (values: ChannelFormValues) => {
    const input = toApiInput(values);
    if (editingChannel) {
      updateMutation.mutate({
        id: editingChannel.id,
        // A cleared field comes back as null, which resets the channel to the default threshold.
        input: {
          ...input,
          similarityThreshold: values.similarityThreshold ?? null,
        },
      });
    } else {
      createMutation.mutate(input);
    }
  };

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
          Channels
        </Title>
        <Space>
          <Tooltip title="Refresh">
            <Button
              icon={<ReloadOutlined />}
              loading={isFetching}
              onClick={() => refetch()}
            />
          </Tooltip>
          <Tooltip title="Add Channel">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingChannel(null);
                setFormOpen(true);
              }}
            />
          </Tooltip>
        </Space>
      </Space>

      <div className="list-container">
        <Table
          className="list-table"
          bordered
          size="middle"
          rowKey="id"
          loading={isLoading}
          dataSource={(channels ?? []).slice(
            (page - 1) * pageSize,
            page * pageSize,
          )}
          pagination={false}
          footer={() => (
            <Pagination
              current={page}
              pageSize={pageSize}
              total={channels?.length ?? 0}
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
              title: 'Name',
              dataIndex: 'name',
              render: (name: string, record: VideoFeedSource) => (
                <Link
                  onClick={() => {
                    setEditingChannel(record);
                    setFormOpen(true);
                  }}
                >
                  {name}
                </Link>
              ),
            },
            { title: 'Type', dataIndex: 'type', render: (t) => <Tag>{t}</Tag> },
            {
              title: 'Enabled',
              dataIndex: 'enabled',
              render: (enabled: boolean) => (enabled ? 'Yes' : 'No'),
            },
            {
              title: 'Similarity Threshold',
              dataIndex: 'similarityThreshold',
              render: (value: number | null) =>
                value === null ? 'Default' : value.toFixed(2),
            },
            { title: 'Alerts', dataIndex: 'alertCount' },
            {
              title: '',
              width: 120,
              align: 'right' as const,
              render: (_, record: VideoFeedSource) => {
                const verifying =
                  verifyMutation.isPending &&
                  verifyMutation.variables === record.id;
                const deleteDisabled =
                  !record.removable || record.alertCount > 0;
                return (
                  <div className="list-actions-column">
                    <Tooltip title="Verify">
                      {verifying ? (
                        <LoadingOutlined className="list-actions-icon" />
                      ) : (
                        <CheckCircleOutlined
                          className="list-actions-icon"
                          onClick={() => verifyMutation.mutate(record.id)}
                        />
                      )}
                    </Tooltip>
                    <Tooltip title="Test Match">
                      <ExperimentOutlined
                        className="list-actions-icon"
                        onClick={() => setTestMatchChannel(record)}
                      />
                    </Tooltip>
                    <Tooltip
                      title={
                        !record.removable
                          ? 'This channel cannot be removed.'
                          : record.alertCount > 0
                            ? 'This channel has alert history and cannot be deleted.'
                            : 'Delete'
                      }
                    >
                      <Popconfirm
                        title="Delete this channel?"
                        disabled={deleteDisabled}
                        onConfirm={() => removeMutation.mutate(record.id)}
                      >
                        <DeleteOutlined
                          className="list-actions-icon"
                          style={
                            deleteDisabled
                              ? {
                                  color: 'rgba(0, 0, 0, 0.25)',
                                  cursor: 'not-allowed',
                                }
                              : undefined
                          }
                        />
                      </Popconfirm>
                    </Tooltip>
                  </div>
                );
              },
            },
          ]}
        />
      </div>

      <ChannelFormModal
        open={formOpen}
        channel={editingChannel}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        togglingEnabled={toggleEnabledMutation.isPending}
        onCancel={() => {
          setFormOpen(false);
          setEditingChannel(null);
        }}
        onSubmit={handleSubmit}
        onToggleEnabled={(id, enabled) =>
          toggleEnabledMutation.mutate({ id, enabled })
        }
      />

      <TestMatchModal
        open={!!testMatchChannel}
        channel={testMatchChannel}
        onClose={() => setTestMatchChannel(null)}
        onThresholdSaved={() => {
          invalidate();
          setTestMatchChannel(null);
        }}
      />

      {previewImage && (
        <Image
          style={{ display: 'none' }}
          src={previewImage}
          preview={{
            visible: true,
            onVisibleChange: (visible) => !visible && setPreviewImage(null),
          }}
        />
      )}
    </div>
  );
}
