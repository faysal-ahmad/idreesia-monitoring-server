import { useQuery } from '@tanstack/react-query';
import { Divider, Empty, Image, Modal, Space, Spin, Typography } from 'antd';
import { monitoringProfilesApi } from '../api/monitoring-profiles';
import { Alert } from '../api/types';

const { Text } = Typography;

interface AlertImagesModalProps {
  alert: Alert | null;
  onClose: () => void;
}

// Shows the captured frame above all of the matched profile's saved photos so they can be
// compared. Reviewing the match happens in the ERP.
export function AlertImagesModal({ alert, onClose }: AlertImagesModalProps) {
  const profileId = alert?.profile.id ?? null;

  const { data: profile, isLoading } = useQuery({
    queryKey: ['monitoring-profiles', profileId],
    queryFn: () => monitoringProfilesApi.get(profileId!),
    enabled: !!profileId,
  });

  return (
    <Modal
      title={alert ? `Alert — ${alert.profile.name}` : 'Alert'}
      open={!!alert}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnHidden
    >
      {alert && (
        <>
          <Space orientation="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>Captured frame</Text>
            <Text type="secondary">
              {alert.channel.name} ·{' '}
              {new Date(alert.timestamp).toLocaleString()} ·{' '}
              {Math.round(alert.similarityScore * 100)}% confidence
              {alert.faceSizePx !== null && ` · face ${alert.faceSizePx}px`}
              {alert.faceQuality && ` · quality ${alert.faceQuality.score}%`}
            </Text>
            {!!alert.faceQuality?.reasons.length && (
              <Text type="warning">{alert.faceQuality.reasons.join(', ')}</Text>
            )}
            <Image
              src={`/api/alert-images/${alert.imageFile}`}
              preview={false}
              style={{ maxHeight: 400, objectFit: 'contain' }}
            />
          </Space>

          <Divider />

          <Space orientation="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>Profile photos — {alert.profile.name}</Text>
            {isLoading && <Spin />}
            {profile?.images.length === 0 && (
              <Empty description="This profile has no photos" />
            )}
            <Space wrap>
              {profile?.images.map((image) => (
                <Image
                  key={image.id}
                  src={image.previewImage}
                  preview={false}
                  width={140}
                  height={140}
                  style={{ objectFit: 'cover' }}
                />
              ))}
            </Space>
          </Space>
        </>
      )}
    </Modal>
  );
}
