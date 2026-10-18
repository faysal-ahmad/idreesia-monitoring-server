import {
  CheckCircleOutlined,
  CloseCircleOutlined,
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
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { alertsApi } from '../api/alerts';
import { Alert } from '../api/types';
import { AlertImagesModal } from '../components/alert-images-modal';
import AlertsListFilter, {
  AlertsFilter,
  AlertsFilterOption,
  AlertsListFilterChips,
} from '../components/alerts-list-filter';

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

// Filters live in the URL query string, so a filtered view survives a reload and can be shared.
function parseFilter(params: URLSearchParams): AlertsFilter {
  return {
    profileId: params.get('profileId') ?? undefined,
    channelId: params.get('channelId') ?? undefined,
    hideTestProfiles: params.get('hideTestProfiles') === 'true',
  };
}

function toSearchParams(filter: AlertsFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.profileId) params.set('profileId', filter.profileId);
  if (filter.channelId) params.set('channelId', filter.channelId);
  if (filter.hideTestProfiles) params.set('hideTestProfiles', 'true');
  return params;
}

function matchesFilter(alert: Alert, filter: AlertsFilter): boolean {
  if (filter.profileId && alert.profile.id !== filter.profileId) return false;
  if (filter.channelId && alert.channel.id !== filter.channelId) return false;
  if (filter.hideTestProfiles && alert.profile.isTest) return false;
  return true;
}

// Filter dropdowns only offer people/channels that actually have alerts.
function distinctOptions(
  alerts: Alert[],
  pick: (alert: Alert) => AlertsFilterOption,
): AlertsFilterOption[] {
  const byId = new Map(alerts.map((alert) => [pick(alert).id, pick(alert)]));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  // Stored by id and read from the query data, so the dialog reflects a review as soon as it's saved.
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const selectedAlert =
    alerts?.find((alert) => alert.id === selectedAlertId) ?? null;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // Alert id -> time its row stops flashing.
  const [flashUntil, setFlashUntil] = useState<Map<string, number>>(
    () => new Map(),
  );
  // null until the first fetch, so alerts already present when the page opens don't flash.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [isSoundEnabled, setIsSoundEnabled] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => parseFilter(searchParams), [searchParams]);
  const setFilter = (next: AlertsFilter) => {
    setSearchParams(toSearchParams(next));
    setPage(1);
  };
  const visibleAlerts = (alerts ?? []).filter((alert) =>
    matchesFilter(alert, filter),
  );
  const filterProps = {
    filter,
    setFilter,
    profiles: distinctOptions(alerts ?? [], (alert) => alert.profile),
    channels: distinctOptions(alerts ?? [], (alert) => alert.channel),
  };

  const stopFlashing = (alertId: string) =>
    setFlashUntil((previous) => {
      if (!previous.has(alertId)) return previous;
      const next = new Map(previous);
      next.delete(alertId);
      return next;
    });

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
    // Alerts hidden by the filter still flash if it's cleared in time, but don't beep.
    if (newAlerts.some((alert) => matchesFilter(alert, filter))) {
      playAlertTone();
    }
    // Re-running on a filter change is harmless: seenIds already holds every alert, so nothing is new.
  }, [alerts, filter]);

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
      <div className="list-table-header" style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Alerts
        </Title>
        <div className="list-table-header-utilities">
          <Space size={8}>
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
            <AlertsListFilter {...filterProps} />
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
          <AlertsListFilterChips {...filterProps} />
        </div>
      </div>
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
              setSelectedAlertId(record.id);
              stopFlashing(record.id);
            },
            style: { cursor: 'pointer' },
          })}
          loading={isLoading}
          dataSource={visibleAlerts.slice(
            (page - 1) * pageSize,
            page * pageSize,
          )}
          pagination={false}
          footer={() => (
            <Pagination
              current={page}
              pageSize={pageSize}
              total={visibleAlerts.length}
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
            {
              title: 'Monitored Person',
              render: (_, record: Alert) => (
                <>
                  <div>{record.profile.name}</div>
                  {record.profile.isTest && (
                    <Tag
                      color="purple"
                      style={{ marginTop: 4, borderRadius: 999, fontSize: 11 }}
                    >
                      Test profile
                    </Tag>
                  )}
                </>
              ),
            },
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
            {
              title: 'Review',
              dataIndex: 'review',
              render: (review: Alert['review']) =>
                review === 'CORRECT' ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    Correct
                  </Tag>
                ) : review === 'FALSE_POSITIVE' ? (
                  <Tag color="error" icon={<CloseCircleOutlined />}>
                    False positive
                  </Tag>
                ) : null,
            },
          ]}
          locale={{ emptyText: 'No alerts yet.' }}
        />
      </div>
      <AlertImagesModal
        alert={selectedAlert}
        onClose={() => setSelectedAlertId(null)}
      />
    </div>
  );
}
