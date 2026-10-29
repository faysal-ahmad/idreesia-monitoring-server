import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Empty,
  Progress,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ReactNode, useState } from 'react';
import { usageStatsApi } from '../api/usage-stats';
import { ChannelUsage, ServerUsage } from '../api/types';

const { Title } = Typography;

// Stats are written once a minute by default, so polling faster gains nothing.
const REFRESH_INTERVAL_MS = 60_000;

// In minutes. Ranges shorter than a few stats windows (60s by default) cover only a handful of rows.
const RANGE_OPTIONS = [
  { label: 'Last 10 minutes', value: 10 },
  { label: 'Last 30 minutes', value: 30 },
  { label: 'Last hour', value: 60 },
  { label: 'Last 3 hours', value: 180 },
  { label: 'Last 12 hours', value: 720 },
  { label: 'Last 24 hours', value: 1440 },
  { label: 'Last 7 days', value: 10080 },
];

// Beyond these, channels start losing frames that were due for recognition.
const INFERENCE_WARNING_PCT = 70;
const INFERENCE_ERROR_PCT = 90;
const BUSY_SKIP_WARNING_PCT = 5;

function withTooltip(title: string, tooltip: string) {
  return (
    <Tooltip title={tooltip}>
      <span>{title}</span>
    </Tooltip>
  );
}

function Tile({
  title,
  tooltip,
  children,
  subtext,
}: {
  title: string;
  tooltip: string;
  children: ReactNode;
  subtext?: ReactNode;
}) {
  return (
    <Card size="small" title={withTooltip(title, tooltip)}>
      {children}
      {subtext && <div className="usage-tile-subtext">{subtext}</div>}
    </Card>
  );
}

function ServerTiles({ server }: { server: ServerUsage }) {
  const inferencePct = server.inferenceBusyAvgPct ?? 0;
  const inferenceStatus =
    inferencePct >= INFERENCE_ERROR_PCT
      ? 'exception'
      : inferencePct >= INFERENCE_WARNING_PCT
        ? 'normal'
        : 'normal';
  const hasGpu = server.gpuUtilAvgPct !== null;

  return (
    <div className="usage-tiles">
      <Tile
        title="Inference Lane"
        tooltip="Share of time spent in face detection and embedding. This runs on one thread and is the capacity that runs out first: near 100%, channels start dropping frames."
        subtext={`Peak ${server.inferenceBusyMaxPct ?? 0}% in one window`}
      >
        <Statistic value={inferencePct} suffix="% busy" />
        <Progress
          percent={Math.min(inferencePct, 100)}
          status={inferenceStatus}
          strokeColor={
            inferencePct >= INFERENCE_WARNING_PCT &&
            inferencePct < INFERENCE_ERROR_PCT
              ? '#faad14'
              : undefined
          }
          showInfo={false}
        />
      </Tile>
      <Tile
        title="GPU"
        tooltip="Utilisation of the busiest GPU, sampled every few seconds from nvidia-smi."
        subtext={
          hasGpu
            ? `Peak ${server.gpuUtilMaxPct}% · ${server.gpuMemUsedMb ?? '-'} / ${server.gpuMemTotalMb ?? '-'} MiB`
            : `No GPU visible · inference on ${server.dnnTarget.toUpperCase()}`
        }
      >
        <Statistic
          value={server.gpuUtilAvgPct ?? '-'}
          suffix={hasGpu ? '% util' : undefined}
        />
      </Tile>
      <Tile
        title="CPU"
        tooltip="Server process CPU, mostly video decoding."
        subtext={`of ${server.cpuCores} cores`}
      >
        <Statistic
          value={((server.cpuAvgPct ?? 0) / 100).toFixed(1)}
          suffix="cores"
        />
      </Tile>
      <Tile
        title="Active Channels"
        tooltip="Channels that delivered at least one frame in the latest window. Event-loop lag shows how long timers and requests were kept waiting."
        subtext={`Event-loop lag p95 ${server.eventLoopLagP95Ms ?? 0} ms · max ${server.eventLoopLagMaxMs ?? 0} ms`}
      >
        <Statistic value={server.activeChannels} />
      </Tile>
    </div>
  );
}

export default function UsagePage() {
  const [minutes, setMinutes] = useState(60);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['usage-stats', minutes],
    queryFn: () => usageStatsApi.get(minutes),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

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
          Usage
        </Title>
        <Space>
          <Select
            options={RANGE_OPTIONS}
            value={minutes}
            onChange={setMinutes}
            style={{ width: 160 }}
          />
          <Tooltip title="Refresh">
            <Button
              icon={<ReloadOutlined />}
              loading={isFetching}
              onClick={() => refetch()}
            />
          </Tooltip>
        </Space>
      </Space>

      {data && !data.statsEnabled && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="Usage stats collection is turned off on this server (STATS_INTERVAL_SECONDS=0)."
        />
      )}

      {data?.server && <ServerTiles server={data.server} />}

      <div className="list-container">
        <Table
          className="list-table"
          bordered
          size="middle"
          rowKey="channelId"
          loading={isLoading}
          dataSource={data?.channels ?? []}
          pagination={false}
          locale={{
            emptyText: (
              <Empty description="No stats collected in this range yet" />
            ),
          }}
          columns={[
            { title: 'Channel', dataIndex: 'name' },
            {
              title: withTooltip(
                'Resolution',
                'Frame size as decoded, before downscaling. Decoding cost grows with frame size and read rate.',
              ),
              render: (_, record: ChannelUsage) =>
                record.frameWidth && record.frameHeight
                  ? `${record.frameWidth}×${record.frameHeight}`
                  : '-',
            },
            {
              title: withTooltip(
                'Read fps',
                'Frames read from the camera per second. All of them are decoded.',
              ),
              dataIndex: 'readFps',
              sorter: (a: ChannelUsage, b: ChannelUsage) =>
                a.readFps - b.readFps,
            },
            {
              title: withTooltip(
                'Processed fps',
                'Frames analysed per second, against the channel’s configured recognition rate.',
              ),
              dataIndex: 'processedFps',
              sorter: (a: ChannelUsage, b: ChannelUsage) =>
                a.processedFps - b.processedFps,
              render: (value: number, record: ChannelUsage) =>
                `${value} / ${record.recognitionFps}`,
            },
            {
              title: withTooltip(
                'Busy Skip',
                'Frames due for recognition but dropped because the previous one was still processing. Above zero, the server can’t keep up with this channel’s recognition rate.',
              ),
              dataIndex: 'busySkipPct',
              sorter: (a: ChannelUsage, b: ChannelUsage) =>
                a.busySkipPct - b.busySkipPct,
              render: (value: number) =>
                value >= BUSY_SKIP_WARNING_PCT ? (
                  <Tag color="error">{value}%</Tag>
                ) : (
                  `${value}%`
                ),
            },
            {
              title: withTooltip(
                'Inference Share',
                'This channel’s share of the inference lane: the part of the server’s busy % it accounts for.',
              ),
              dataIndex: 'inferenceSharePct',
              defaultSortOrder: 'descend' as const,
              sorter: (a: ChannelUsage, b: ChannelUsage) =>
                a.inferenceSharePct - b.inferenceSharePct,
              render: (value: number) => `${value}%`,
            },
            {
              title: withTooltip(
                'Faces',
                'Faces that passed the channel’s size and quality checks and were matched against profiles.',
              ),
              dataIndex: 'faces',
              sorter: (a: ChannelUsage, b: ChannelUsage) => a.faces - b.faces,
            },
            {
              title: withTooltip(
                'Faces Skipped',
                'Share of detected faces ignored as too small or too poor to match (see the channel’s min face size and quality). Near 100% means the camera is too far away or the minimums are too strict.',
              ),
              dataIndex: 'faceSkipPct',
              sorter: (a: ChannelUsage, b: ChannelUsage) =>
                a.faceSkipPct - b.faceSkipPct,
              render: (value: number, record: ChannelUsage) => (
                <Tooltip
                  title={`${record.skippedFaceSize} too small, ${record.skippedFaceQuality} too poor`}
                >
                  {value}%
                </Tooltip>
              ),
            },
            {
              title: withTooltip(
                'Read Failures',
                'Empty or failed frame reads from the camera stream.',
              ),
              dataIndex: 'readFailures',
              sorter: (a: ChannelUsage, b: ChannelUsage) =>
                a.readFailures - b.readFailures,
            },
            {
              title: 'Reconnects',
              dataIndex: 'reconnects',
              sorter: (a: ChannelUsage, b: ChannelUsage) =>
                a.reconnects - b.reconnects,
              render: (value: number) =>
                value > 0 ? <Tag color="warning">{value}</Tag> : value,
            },
          ]}
        />
      </div>
    </div>
  );
}
