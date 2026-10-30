import { InboxOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Drawer,
  Empty,
  Image,
  Popconfirm,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import { monitoringProfilesApi } from '../api/monitoring-profiles';

const { Text } = Typography;

interface ProfileImagesDrawerProps {
  profileId: string | null;
  onClose: () => void;
}

export function ProfileImagesDrawer({
  profileId,
  onClose,
}: ProfileImagesDrawerProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ['monitoring-profiles', profileId],
    queryFn: () => monitoringProfilesApi.get(profileId!),
    enabled: !!profileId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['monitoring-profiles', profileId],
    });

  const uploadMutation = useMutation({
    mutationFn: ({
      file,
      acknowledgeWarning,
    }: {
      file: File;
      acknowledgeWarning: boolean;
    }) => monitoringProfilesApi.addImage(profileId!, file, acknowledgeWarning),
    onSuccess: (result, { file }) => {
      if (result.status === 'rejected') {
        message.error(result.reason);
        return;
      }
      if (result.status === 'warning') {
        modal.confirm({
          title: 'Lower-quality photo',
          content: result.reason,
          okText: 'Upload anyway',
          cancelText: 'Choose a different photo',
          onOk: () => uploadMutation.mutate({ file, acknowledgeWarning: true }),
        });
        return;
      }
      message.success('Image added');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['monitoring-profiles'] });
    },
    onError: (error) =>
      message.error(error instanceof Error ? error.message : 'Upload failed'),
  });

  const removeImageMutation = useMutation({
    mutationFn: (imageId: string) =>
      monitoringProfilesApi.removeImage(profileId!, imageId),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['monitoring-profiles'] });
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to remove image',
      ),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (imageId: string) =>
      monitoringProfilesApi.setDefaultImage(profileId!, imageId),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['monitoring-profiles'] });
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to set default photo',
      ),
  });

  const uploadProps: UploadProps = {
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      uploadMutation.mutate({ file, acknowledgeWarning: false });
      return false;
    },
  };

  return (
    <Drawer
      title={profile ? `Photos — ${profile.name}` : 'Photos'}
      open={!!profileId}
      onClose={onClose}
      size={480}
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Upload.Dragger {...uploadProps}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Click or drag a photo to add it</p>
          <p className="ant-upload-hint">
            Use a clear, close-up photo showing only this person. No group
            shots.
          </p>
        </Upload.Dragger>

        {uploadMutation.isPending && (
          <Text type="secondary">Analyzing photo…</Text>
        )}

        {profile?.images.length === 0 && <Empty description="No photos yet" />}

        <Image.PreviewGroup>
          <Space wrap>
            {profile?.images.map((image) => (
              <div key={image.id} style={{ position: 'relative' }}>
                <Image
                  src={image.previewImage}
                  width={140}
                  height={140}
                  style={{ objectFit: 'cover' }}
                />
                {image.id === profile?.defaultImageId ? (
                  <Tag
                    variant="solid"
                    color="blue"
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      left: 4,
                      marginInlineEnd: 0,
                    }}
                  >
                    Default
                  </Tag>
                ) : (
                  <Button
                    size="small"
                    loading={
                      setDefaultMutation.isPending &&
                      setDefaultMutation.variables === image.id
                    }
                    onClick={() => setDefaultMutation.mutate(image.id)}
                    style={{ position: 'absolute', bottom: 4, left: 4 }}
                  >
                    Set as default
                  </Button>
                )}
                <Popconfirm
                  title="Remove this photo?"
                  onConfirm={() => removeImageMutation.mutate(image.id)}
                >
                  <Button
                    size="small"
                    danger
                    style={{ position: 'absolute', top: 4, right: 4 }}
                  >
                    Remove
                  </Button>
                </Popconfirm>
              </div>
            ))}
          </Space>
        </Image.PreviewGroup>
      </Space>
    </Drawer>
  );
}
