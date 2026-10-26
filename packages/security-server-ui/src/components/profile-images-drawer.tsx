import { InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Empty, Image, Popconfirm, Space, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { monitoringProfilesApi } from '../api/monitoring-profiles';
import { FaceQuality, FaceQualitySignal } from '../api/types';

const { Text } = Typography;

const SIGNAL_LABELS: Record<FaceQualitySignal, string> = {
  size: 'Face size',
  confidence: 'Detection confidence',
  sharpness: 'Sharpness',
  exposure: 'Exposure',
  pose: 'Pose',
};

function qualityColor(score: number) {
  if (score >= 70) return 'green';
  if (score >= 40) return 'gold';
  return 'red';
}

// Drawn over the bottom-left corner of a thumbnail; the breakdown is in the tooltip.
function QualityBadge({ quality }: { quality: FaceQuality | null }) {
  const style = { position: 'absolute' as const, bottom: 4, left: 4, marginInlineEnd: 0 };
  if (!quality) {
    return (
      <Tooltip title="Not rated (no face found)">
        <Tag variant="solid" color="default" style={style}>
          —
        </Tag>
      </Tooltip>
    );
  }

  const tooltip = (
    <>
      {quality.reasons.length > 0 && <div style={{ marginBottom: 4 }}>{quality.reasons.join(', ')}</div>}
      {(Object.keys(SIGNAL_LABELS) as FaceQualitySignal[]).map((signal) => (
        <div key={signal}>
          {SIGNAL_LABELS[signal]}: {Math.round(quality.signals[signal] * 100)}%
        </div>
      ))}
    </>
  );
  return (
    <Tooltip title={tooltip}>
      <Tag variant="solid" color={qualityColor(quality.score)} style={style}>
        {quality.score}%
      </Tag>
    </Tooltip>
  );
}

interface ProfileImagesDrawerProps {
  profileId: string | null;
  onClose: () => void;
}

export function ProfileImagesDrawer({ profileId, onClose }: ProfileImagesDrawerProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ['monitoring-profiles', profileId],
    queryFn: () => monitoringProfilesApi.get(profileId!),
    enabled: !!profileId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['monitoring-profiles', profileId] });

  const uploadMutation = useMutation({
    mutationFn: ({ file, acknowledgeWarning }: { file: File; acknowledgeWarning: boolean }) =>
      monitoringProfilesApi.addImage(profileId!, file, acknowledgeWarning),
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
      message.success(`Image added — quality ${result.image.quality.score}%`);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['monitoring-profiles'] });
    },
    onError: (error) => message.error(error instanceof Error ? error.message : 'Upload failed'),
  });

  const removeImageMutation = useMutation({
    mutationFn: (imageId: string) => monitoringProfilesApi.removeImage(profileId!, imageId),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['monitoring-profiles'] });
    },
    onError: (error) => message.error(error instanceof Error ? error.message : 'Failed to remove image'),
  });

  const recalculateMutation = useMutation({
    mutationFn: () => monitoringProfilesApi.recalculateQuality(profileId!),
    onSuccess: ({ recalculated, notRated }) => {
      const suffix = notRated > 0 ? ` (${notRated} had no detectable face)` : '';
      message.success(`Quality recalculated for ${recalculated} photo(s)${suffix}`);
      invalidate();
    },
    onError: (error) => message.error(error instanceof Error ? error.message : 'Failed to recalculate quality'),
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
    <Drawer title={profile ? `Photos — ${profile.name}` : 'Photos'} open={!!profileId} onClose={onClose} size={480}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Upload.Dragger {...uploadProps}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Click or drag a photo to add it</p>
          <p className="ant-upload-hint">
            Use a clear, close-up photo showing only this person. No group shots.
          </p>
        </Upload.Dragger>

        {uploadMutation.isPending && <Text type="secondary">Analyzing photo…</Text>}

        {profile?.images.length === 0 && <Empty description="No photos yet" />}

        {!!profile?.images.length && (
          <Button
            icon={<ReloadOutlined />}
            loading={recalculateMutation.isPending}
            onClick={() => recalculateMutation.mutate()}
          >
            Recalculate quality
          </Button>
        )}

        <Image.PreviewGroup>
          <Space wrap>
            {profile?.images.map((image) => (
              <div key={image.id} style={{ position: 'relative' }}>
                <Image src={image.previewImage} width={140} height={140} style={{ objectFit: 'cover' }} />
                <QualityBadge quality={image.quality} />
                <Popconfirm title="Remove this photo?" onConfirm={() => removeImageMutation.mutate(image.id)}>
                  <Button size="small" danger style={{ position: 'absolute', top: 4, right: 4 }}>
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
