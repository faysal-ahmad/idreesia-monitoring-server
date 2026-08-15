import {
  DeleteOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Pagination,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import { useState } from 'react';
import { monitoringProfilesApi } from '../api/monitoring-profiles';
import { MonitoringProfileSummary } from '../api/types';
import {
  ProfileFormModal,
  ProfileFormValues,
} from '../components/profile-form-modal';
import { ProfileImagesDrawer } from '../components/profile-images-drawer';

const { Title, Link } = Typography;

export default function MonitoringProfilesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'live-profiles' | 'test-profiles'>(
    'live-profiles',
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<MonitoringProfileSummary | null>(null);
  const [imagesProfileId, setImagesProfileId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const {
    data: profiles,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['monitoring-profiles'],
    queryFn: monitoringProfilesApi.list,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['monitoring-profiles'] });

  const createMutation = useMutation({
    mutationFn: monitoringProfilesApi.create,
    onSuccess: () => {
      message.success('Profile created');
      setFormOpen(false);
      invalidate();
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to create profile',
      ),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProfileFormValues }) =>
      monitoringProfilesApi.update(id, input),
    onSuccess: () => {
      message.success('Profile updated');
      setFormOpen(false);
      setEditingProfile(null);
      invalidate();
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to update profile',
      ),
  });

  const removeMutation = useMutation({
    mutationFn: monitoringProfilesApi.remove,
    onSuccess: () => {
      message.success('Profile deleted');
      invalidate();
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to delete profile',
      ),
  });

  const filtered = (profiles ?? []).filter((p) =>
    activeTab === 'test-profiles' ? p.isTest : !p.isTest,
  );
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name: string, record: MonitoringProfileSummary) => (
        <Link
          onClick={() => {
            setEditingProfile(record);
            setFormOpen(true);
          }}
        >
          {name}
        </Link>
      ),
    },
    { title: 'Photos', dataIndex: 'imageCount' },
    { title: 'Alerts', dataIndex: 'alertCount' },
    {
      title: '',
      width: 88,
      align: 'right' as const,
      render: (_: unknown, record: MonitoringProfileSummary) => (
        <div className="list-actions-column">
          <Tooltip title="Photos">
            <PictureOutlined
              className="list-actions-icon"
              onClick={() => setImagesProfileId(record.id)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this profile?"
            description="This also deletes its photos and alert history."
            onConfirm={() => removeMutation.mutate(record.id)}
          >
            <Tooltip title="Delete">
              <DeleteOutlined className="list-actions-icon" />
            </Tooltip>
          </Popconfirm>
        </div>
      ),
    },
  ];

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
          Monitoring Profiles
        </Title>
        <Space>
          <Tooltip title="Refresh">
            <Button
              icon={<ReloadOutlined />}
              loading={isFetching}
              onClick={() => refetch()}
            />
          </Tooltip>
          <Tooltip title="Add Profile">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingProfile(null);
                setFormOpen(true);
              }}
            />
          </Tooltip>
        </Space>
      </Space>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key as 'live-profiles' | 'test-profiles');
          setPage(1);
        }}
        items={[
          { key: 'live-profiles', label: 'Live Profiles' },
          { key: 'test-profiles', label: 'Test Profiles' },
        ]}
      />

      <div className="list-container">
        <Table
          className="list-table"
          bordered
          size="middle"
          rowKey="id"
          loading={isLoading}
          dataSource={paged}
          columns={columns}
          pagination={false}
          footer={() => (
            <Pagination
              current={page}
              pageSize={pageSize}
              total={filtered.length}
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
        />
      </div>

      <ProfileFormModal
        open={formOpen}
        profile={editingProfile}
        defaultIsTest={activeTab === 'test-profiles'}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onCancel={() => {
          setFormOpen(false);
          setEditingProfile(null);
        }}
        onSubmit={(values) =>
          editingProfile
            ? updateMutation.mutate({ id: editingProfile.id, input: values })
            : createMutation.mutate(values)
        }
      />

      <ProfileImagesDrawer
        profileId={imagesProfileId}
        onClose={() => setImagesProfileId(null)}
      />
    </div>
  );
}
