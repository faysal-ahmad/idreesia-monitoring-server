import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Pagination,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { useState } from 'react';
import {
  ChannelFormModal,
  ChannelFormValues,
  toApiInput,
} from '../components/channel-form-modal';
import { LiveFeedModal } from '../components/live-feed';
import {
  DEFAULT_MIN_FACE_QUALITY,
  DEFAULT_MIN_FACE_SIZE_PX,
  DEFAULT_SIMILARITY_THRESHOLD,
} from '../api/channel-defaults';
import { videoFeedSourcesApi } from '../api/video-feed-sources';
import { VideoFeedSource } from '../api/types';

const { Title, Link } = Typography;

export default function ChannelsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<VideoFeedSource | null>(
    null,
  );
  const [liveChannel, setLiveChannel] = useState<VideoFeedSource | null>(null);
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
        recognitionFps: number;
        minFaceSizePx: number | null;
        minFaceQuality: number | null;
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

  const handleSubmit = (values: ChannelFormValues) => {
    const input = toApiInput(values);
    if (editingChannel) {
      updateMutation.mutate({
        id: editingChannel.id,
        // A cleared threshold or minimum comes back as null, which resets it to the default.
        input: {
          ...input,
          similarityThreshold: values.similarityThreshold ?? null,
          recognitionFps: values.recognitionFps!,
          minFaceSizePx: values.minFaceSizePx ?? null,
          minFaceQuality: values.minFaceQuality ?? null,
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
            {
              title: 'Enabled',
              dataIndex: 'enabled',
              render: (enabled: boolean) => (enabled ? 'Yes' : 'No'),
            },
            {
              title: 'Recognition Rate',
              dataIndex: 'recognitionFps',
              render: (value: number) => `${value} fps`,
            },
            {
              title: 'Similarity Threshold',
              dataIndex: 'similarityThreshold',
              render: (value: number | null) =>
                (value ?? DEFAULT_SIMILARITY_THRESHOLD).toFixed(2),
            },
            {
              title: 'Min Face Size',
              dataIndex: 'minFaceSizePx',
              render: (value: number | null) => {
                const size = value ?? DEFAULT_MIN_FACE_SIZE_PX;
                return size === 0 ? 'Off' : `${size} px`;
              },
            },
            {
              title: 'Min Face Quality',
              dataIndex: 'minFaceQuality',
              render: (value: number | null) => {
                const quality = value ?? DEFAULT_MIN_FACE_QUALITY;
                return quality === 0 ? 'Off' : quality;
              },
            },
            { title: 'Alerts', dataIndex: 'alertCount' },
            {
              title: '',
              width: 120,
              align: 'right' as const,
              render: (_, record: VideoFeedSource) => {
                const deleteDisabled = record.alertCount > 0;
                return (
                  <div className="list-actions-column">
                    <Tooltip title="Live view">
                      <VideoCameraOutlined
                        className="list-actions-icon"
                        onClick={() => setLiveChannel(record)}
                      />
                    </Tooltip>
                    <Tooltip
                      title={
                        deleteDisabled
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

      <LiveFeedModal
        channel={liveChannel}
        onClose={() => setLiveChannel(null)}
      />
    </div>
  );
}
