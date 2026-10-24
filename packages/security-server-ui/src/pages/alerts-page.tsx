import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  MutedOutlined,
} from '@ant-design/icons';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Alert as AntAlert,
  Badge,
  Button,
  Image,
  Pagination,
  Progress,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { alertsApi } from '../api/alerts';
import { Alert, AlertPage } from '../api/types';
import { AlertImagesModal } from '../components/alert-images-modal';
import ChannelHealthSummary from '../components/channel-health-summary';
import AlertsListFilter, {
  AlertsFilter,
  AlertsListFilterChips,
} from '../components/alerts-list-filter';

const { Title } = Typography;

const ALERTS_STREAM_URL = '/api/alerts/stream';

type StreamStatus = 'connecting' | 'live' | 'reconnecting';

const STREAM_STATUS_BADGE: Record<
  StreamStatus,
  { status: 'success' | 'processing' | 'error'; text: string }
> = {
  live: { status: 'success', text: 'Server connected' },
  connecting: { status: 'processing', text: 'Connecting to server' },
  reconnecting: { status: 'error', text: 'Not connected' },
};
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

// Paging and filtering happen on the server; this is only used to decide whether a live
// alert is relevant to the current view (tone, "new alerts" notice).
function matchesFilter(alert: Alert, filter: AlertsFilter): boolean {
  if (filter.profileId && alert.profile.id !== filter.profileId) return false;
  if (filter.channelId && alert.channel.id !== filter.channelId) return false;
  if (filter.hideTestProfiles && alert.profile.isTest) return false;
  return true;
}

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => parseFilter(searchParams), [searchParams]);
  const setFilter = (next: AlertsFilter) => {
    setSearchParams(toSearchParams(next));
    setPage(1);
  };

  const { data: alertPage, isLoading } = useQuery({
    queryKey: ['alerts', 'page', { page, pageSize, ...filter }],
    queryFn: () => alertsApi.list({ page, pageSize, ...filter }),
    // Keeps the current rows on screen while the next page/filter loads, instead of flashing empty.
    placeholderData: keepPreviousData,
  });
  const { data: filterOptions } = useQuery({
    queryKey: ['alerts', 'filter-options'],
    queryFn: alertsApi.filterOptions,
  });
  const filterProps = {
    filter,
    setFilter,
    profiles: filterOptions?.profiles ?? [],
    channels: filterOptions?.channels ?? [],
  };

  const [now, setNow] = useState(() => Date.now());
  // A snapshot rather than an id, so the dialog stays open even if a refetch moves the alert off
  // the current page; the on-page copy is preferred while it's there (it has the latest review).
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const shownAlert = selectedAlert
    ? (alertPage?.data.find((alert) => alert.id === selectedAlert.id) ??
      selectedAlert)
    : null;
  // Alert id -> time its row stops flashing.
  const [flashUntil, setFlashUntil] = useState<Map<string, number>>(
    () => new Map(),
  );
  // Matching alerts that arrived while viewing page 2+, where rows are kept still on purpose.
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [isSoundEnabled, setIsSoundEnabled] = useState(false);

  // The stream handlers read these through refs so changing page/filter doesn't reconnect it.
  const pageRef = useRef(page);
  const filterRef = useRef(filter);
  pageRef.current = page;
  filterRef.current = filter;

  const stopFlashing = (alertId: string) =>
    setFlashUntil((previous) => {
      if (!previous.has(alertId)) return previous;
      const next = new Map(previous);
      next.delete(alertId);
      return next;
    });

  // Live updates over Server-Sent Events instead of polling.
  useEffect(() => {
    const resync = () =>
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    // The initial useQuery fetch covers the first connection; any reconnect refetches to pick up
    // whatever changed while disconnected.
    let refetchOnOpen = false;

    setStreamStatus('connecting');
    const source = new EventSource(ALERTS_STREAM_URL);
    source.onopen = () => {
      setStreamStatus('live');
      if (refetchOnOpen) resync();
      refetchOnOpen = true;
    };
    // EventSource reconnects on its own; this only reflects that in the UI.
    source.onerror = () => setStreamStatus('reconnecting');

    source.addEventListener('created', (event) => {
      const { alert } = JSON.parse(event.data) as { alert: Alert };
      const currentTime = Date.now();
      // Flash regardless of filter/page — it only shows if the row is on screen, e.g. once the
      // filter is cleared or the operator jumps to the latest page in time.
      setFlashUntil((previous) => {
        const next = new Map(
          [...previous].filter(([, until]) => until > currentTime),
        );
        next.set(alert.id, currentTime + NEW_ALERT_FLASH_MS);
        return next;
      });
      const relevant = matchesFilter(alert, filterRef.current);
      if (relevant) playAlertTone();

      if (pageRef.current === 1) {
        resync();
      } else {
        // Keep later pages still while being read; the notice offers a jump to the latest.
        if (relevant) setNewAlertCount((count) => count + 1);
        queryClient.invalidateQueries({
          queryKey: ['alerts', 'filter-options'],
        });
      }
    });
    source.addEventListener('reviewed', (event) => {
      const { id, review } = JSON.parse(event.data) as Pick<
        Alert,
        'id' | 'review'
      >;
      queryClient.setQueriesData<AlertPage>(
        { queryKey: ['alerts', 'page'] },
        (current) =>
          current && {
            ...current,
            data: current.data.map((alert) =>
              alert.id === id ? { ...alert, review } : alert,
            ),
          },
      );
      setSelectedAlert((current) =>
        current?.id === id ? { ...current, review } : current,
      );
    });
    source.addEventListener('resync', resync);

    return () => source.close();
  }, [queryClient]);

  // Ticks every second so rows stop flashing on time.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // A freshly fetched page already includes everything the notice was counting.
  useEffect(() => setNewAlertCount(0), [page, pageSize, filter]);

  // A page can end up past the end (e.g. after older alerts are purged) — go to the last one.
  useEffect(() => {
    if (!alertPage || alertPage.data.length > 0 || page === 1) return;
    if (alertPage.total > 0) setPage(Math.ceil(alertPage.total / pageSize));
  }, [alertPage, page, pageSize]);

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
      {/* Browsers block audio until the user interacts with the page; any click unlocks it (see
          the pointerdown/keydown listener above), after which this banner disappears. */}
      {!isSoundEnabled && (
        <AntAlert
          type="warning"
          showIcon
          icon={<MutedOutlined />}
          style={{ marginBottom: 16 }}
          message="Click anywhere on the page to enable sound alerts."
        />
      )}
      <div className="list-table-header" style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Alerts
        </Title>
        {/* Channel health only means anything while the server itself is reachable. */}
        <div className="alerts-status-bar">
          <Badge {...STREAM_STATUS_BADGE[streamStatus]} />
          {streamStatus === 'live' && <ChannelHealthSummary />}
        </div>
        <div className="list-table-header-utilities">
          <AlertsListFilter {...filterProps} />
          <AlertsListFilterChips {...filterProps} />
        </div>
      </div>
      {newAlertCount > 0 && page !== 1 && (
        <AntAlert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${newAlertCount} new alert${newAlertCount === 1 ? '' : 's'} since this page loaded.`}
          action={
            <Button size="small" type="primary" onClick={() => setPage(1)}>
              Go to latest
            </Button>
          }
        />
      )}
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
              stopFlashing(record.id);
            },
            style: { cursor: 'pointer' },
          })}
          loading={isLoading}
          dataSource={alertPage?.data ?? []}
          pagination={false}
          footer={() => (
            <Pagination
              current={page}
              pageSize={pageSize}
              total={alertPage?.total ?? 0}
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
                  src={`/api/alert-images/${record.imageFile}`}
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
        alert={shownAlert}
        onClose={() => setSelectedAlert(null)}
      />
    </div>
  );
}
