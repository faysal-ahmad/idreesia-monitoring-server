import {
  MutedOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
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
import { useEffect, useRef, useState } from 'react';
import { alertsApi } from '../api/alerts';
import { Alert } from '../api/types';
import { AlertImagesModal } from '../components/alert-images-modal';

const { Text, Title } = Typography;

const REFRESH_INTERVAL_MS = 3000;
const NEW_ALERT_FLASH_MS = 30_000;

// One context for the page's lifetime. Browsers start it suspended until the user interacts
// with the page (autoplay policy), so the tone can only play once it has been unlocked.
let audioContext: AudioContext | null = null;
function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext();
  return audioContext;
}

function playAlertTone() {
  const ctx = getAudioContext();
  // Sounds scheduled on a suspended context would all play late, at once, when it resumes.
  if (ctx.state !== 'running') return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 1760;
  // Quick fade in/out so the tone doesn't click at the start and end.
  const start = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.6);
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function AlertsPage() {
  const [isPaused, setIsPaused] = useState(false);
  const {
    data: alerts,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['alerts'],
    queryFn: alertsApi.list,
    refetchInterval: isPaused ? false : REFRESH_INTERVAL_MS,
  });
  const [now, setNow] = useState(() => Date.now());
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // Alert id -> time its row stops flashing.
  const [flashUntil, setFlashUntil] = useState<Map<string, number>>(
    () => new Map(),
  );
  // null until the first fetch, so alerts already present when the page opens don't flash.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [isSoundEnabled, setIsSoundEnabled] = useState(false);

  // Ticks every second so the "updated Xs ago" label stays current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!alerts) return;
    const seenIds = seenIdsRef.current;
    seenIdsRef.current = new Set(alerts.map((alert) => alert.id));
    if (!seenIds) return;

    const newAlerts = alerts.filter((alert) => !seenIds.has(alert.id));
    if (newAlerts.length === 0) return;

    const currentTime = Date.now();
    setFlashUntil((previous) => {
      const next = new Map(
        [...previous].filter(([, until]) => until > currentTime),
      );
      for (const alert of newAlerts) {
        next.set(alert.id, currentTime + NEW_ALERT_FLASH_MS);
      }
      return next;
    });
    playAlertTone();
  }, [alerts]);

  // Any click or key press on the page unlocks audio; the "Enable sound" button is the explicit way.
  useEffect(() => {
    const ctx = getAudioContext();
    const syncState = () => setIsSoundEnabled(ctx.state === 'running');
    const unlock = () => {
      if (ctx.state === 'suspended') ctx.resume();
    };
    syncState();
    ctx.addEventListener('statechange', syncState);
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      ctx.removeEventListener('statechange', syncState);
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

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
        <Space>
          {!isSoundEnabled && (
            <Tooltip title="The browser blocks sound until you interact with the page">
              <Button
                icon={<MutedOutlined />}
                onClick={() => getAudioContext().resume()}
              >
                Enable sound
              </Button>
            </Tooltip>
          )}
          {dataUpdatedAt > 0 && (
            <Text type="secondary">
              updated {formatElapsed(now - dataUpdatedAt)}
            </Text>
          )}
          <Button
            icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={() => setIsPaused((paused) => !paused)}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
          {isPaused && (
            <Tooltip title="Refresh">
              <Button
                icon={<ReloadOutlined />}
                loading={isFetching}
                onClick={() => refetch()}
              />
            </Tooltip>
          )}
        </Space>
      </Space>
      <div className="list-container">
        <Table
          className="list-table"
          bordered
          size="middle"
          rowKey="id"
          rowClassName={(record) =>
            (flashUntil.get(record.id) ?? 0) > now ? 'alert-row-new' : ''
          }
          onRow={(record) => ({
            onClick: () => {
              setSelectedAlert(record);
              setFlashUntil((previous) => {
                if (!previous.has(record.id)) return previous;
                const next = new Map(previous);
                next.delete(record.id);
                return next;
              });
            },
            style: { cursor: 'pointer' },
          })}
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
                  preview={false}
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
      <AlertImagesModal
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
      />
    </div>
  );
}
