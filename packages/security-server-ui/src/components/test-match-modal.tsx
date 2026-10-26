import { App, Button, InputNumber, Modal, Progress, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { videoFeedSourcesApi } from '../api/video-feed-sources';
import { TestMatchResult, VideoFeedSource } from '../api/types';

const { Text, Paragraph } = Typography;

interface TestMatchModalProps {
  open: boolean;
  channel: VideoFeedSource | null;
  onClose: () => void;
  onThresholdSaved: () => void;
}

export function TestMatchModal({ open, channel, onClose, onThresholdSaved }: TestMatchModalProps) {
  const { message } = App.useApp();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestMatchResult | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const runCapture = async () => {
    if (!channel) return;
    setRunning(true);
    try {
      const res = await videoFeedSourcesApi.testMatch(channel.id);
      setResult(res);
      const topScore = res.results[0]?.score;
      setThreshold(res.currentSimilarityThreshold ?? (topScore !== undefined ? Number(topScore.toFixed(2)) : null));
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Test match failed');
    } finally {
      setRunning(false);
    }
  };

  const saveThreshold = async () => {
    if (!channel || threshold === null) return;
    setSaving(true);
    try {
      await videoFeedSourcesApi.update(channel.id, { similarityThreshold: threshold });
      message.success('Similarity threshold saved');
      onThresholdSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to save threshold');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setThreshold(null);
    onClose();
  };

  return (
    <Modal title={`Test Match — ${channel?.name ?? ''}`} open={open} onCancel={handleClose} footer={null} destroyOnHidden>
      <Paragraph type="secondary">
        Point this channel at someone enrolled as a <Text strong>test profile</Text>, then capture a frame to see the
        computed similarity score. This does not trigger an alert.
      </Paragraph>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Button type="primary" loading={running} onClick={runCapture}>
          Capture &amp; Score
        </Button>

        {result && (
          <>
            <Text type="secondary">Detected face confidence: {(result.detectedFaceConfidence * 100).toFixed(0)}%</Text>
            <Table
              size="small"
              pagination={false}
              rowKey="profileId"
              dataSource={result.results}
              columns={[
                { title: 'Test Profile', dataIndex: 'profileName' },
                {
                  title: 'Cosine Similarity',
                  dataIndex: 'score',
                  render: (score: number) => <Progress percent={Math.round(score * 100)} size="small" />,
                },
              ]}
              locale={{ emptyText: 'No test profiles with enrollment images yet.' }}
            />
            <Space>
              <Text>Set channel similarity threshold:</Text>
              <InputNumber
                min={0}
                max={1}
                step={0.01}
                value={threshold ?? undefined}
                onChange={(v) => setThreshold(v)}
              />
              <Button onClick={saveThreshold} loading={saving} disabled={threshold === null}>
                Save
              </Button>
            </Space>
          </>
        )}
      </Space>
    </Modal>
  );
}
