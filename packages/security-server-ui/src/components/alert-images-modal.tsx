import { useQuery } from '@tanstack/react-query';
import { Divider, Empty, Image, Modal, Space, Spin, Typography } from 'antd';
import { monitoringProfilesApi } from '../api/monitoring-profiles';
import { Alert } from '../api/types';

const { Text } = Typography;

interface AlertImagesModalProps {
  alert: Alert | null;
  onClose: () => void;
}

// Shows the captured frame above all of the matched profile's saved photos so an admin can
// compare them.
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
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>Captured frame</Text>
            <Text type="secondary">
              {alert.channel.name} · {new Date(alert.timestamp).toLocaleString()} ·{' '}
              {Math.round(alert.similarityScore * 100)}% confidence
            </Text>
            <Image src={`/api/alerts/${alert.id}/image`} style={{ maxHeight: 400, objectFit: 'contain' }} />
          </Space>

          <Divider />

          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>Profile photos — {alert.profile.name}</Text>
            {isLoading && <Spin />}
            {profile?.images.length === 0 && <Empty description="This profile has no photos" />}
            <Image.PreviewGroup>
              <Space wrap>
                {profile?.images.map((image) => (
                  <Image
                    key={image.id}
                    src={image.previewImage}
                    width={140}
                    height={140}
                    style={{ objectFit: 'cover' }}
                  />
                ))}
              </Space>
            </Image.PreviewGroup>
          </Space>
        </>
      )}
    </Modal>
  );
}
