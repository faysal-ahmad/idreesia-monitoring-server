import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Divider, Empty, Image, Modal, Space, Spin, Typography } from 'antd';
import { alertsApi } from '../api/alerts';
import { monitoringProfilesApi } from '../api/monitoring-profiles';
import { Alert, AlertPage, AlertReview } from '../api/types';

const { Text } = Typography;

interface AlertImagesModalProps {
  alert: Alert | null;
  onClose: () => void;
}

// Shows the captured frame above all of the matched profile's saved photos so an admin can
// compare them, and record whether the match was correct.
export function AlertImagesModal({ alert, onClose }: AlertImagesModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const profileId = alert?.profile.id ?? null;

  // Optimistic, so the selected button updates immediately rather than on the alerts page's next poll.
  const reviewMutation = useMutation({
    mutationFn: ({ id, review }: { id: string; review: AlertReview | null }) => alertsApi.review(id, review),
    onMutate: ({ id, review }) => {
      queryClient.setQueriesData<AlertPage>(
        { queryKey: ['alerts', 'page'] },
        (current) =>
          current && { ...current, data: current.data.map((item) => (item.id === id ? { ...item, review } : item)) },
      );
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Failed to save review');
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
  // Closes straight away — the save is optimistic, and this component stays mounted while the
  // dialog is closed, so a failure still surfaces as an error message.
  const setReview = (review: AlertReview | null) => {
    if (alert && alert.review !== review) reviewMutation.mutate({ id: alert.id, review });
    onClose();
  };

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
            <Image
              src={`/api/alert-images/${alert.imageFile}`}
              preview={false}
              style={{ maxHeight: 400, objectFit: 'contain' }}
            />
          </Space>

          <Divider />

          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text strong>Profile photos — {alert.profile.name}</Text>
            {isLoading && <Spin />}
            {profile?.images.length === 0 && <Empty description="This profile has no photos" />}
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

          <Divider />

          <Space size="middle" wrap align="center">
            <Text strong>Is this the same person?</Text>
            <Space size="middle" wrap>
              <Button
                size="large"
                color="green"
                variant={alert.review === 'CORRECT' ? 'solid' : 'outlined'}
                icon={<CheckCircleOutlined />}
                onClick={() => setReview('CORRECT')}
              >
                {alert.review === 'CORRECT' ? 'Marked correct' : 'Correct match'}
              </Button>
              <Button
                size="large"
                color="danger"
                variant={alert.review === 'FALSE_POSITIVE' ? 'solid' : 'outlined'}
                icon={<CloseCircleOutlined />}
                onClick={() => setReview('FALSE_POSITIVE')}
              >
                {alert.review === 'FALSE_POSITIVE' ? 'Marked false positive' : 'False positive'}
              </Button>
              {alert.review && (
                <Button type="link" onClick={() => setReview(null)}>
                  Clear review
                </Button>
              )}
            </Space>
          </Space>
        </>
      )}
    </Modal>
  );
}
