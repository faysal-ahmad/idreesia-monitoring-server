import { CameraOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Button, Empty, Modal, Spin, Tooltip, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { FrameAnalysis, VideoFeedSource } from '../api/types';
import { videoFeedSourcesApi } from '../api/video-feed-sources';

const { Text } = Typography;

// One per face on a captured frame, in detection order; repeats past the tenth face.
const FACE_COLORS = [
  '#ff4d4f',
  '#52c41a',
  '#1677ff',
  '#fadb14',
  '#eb2f96',
  '#13c2c2',
  '#fa8c16',
  '#722ed1',
  '#a0d911',
  '#874d00',
];

const faceColor = (index: number) => FACE_COLORS[index % FACE_COLORS.length];

// go2rtc's <video-stream> custom element (its VideoRTC player). Served by go2rtc itself through
// the UI proxy, so the player always matches the running media server version.
interface Go2rtcPlayer extends HTMLElement {
  mode: string;
  media: string;
  src: string;
}

let playerReady: Promise<void> | null = null;

function loadPlayer(): Promise<void> {
  playerReady ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/go2rtc/video-stream.js';
    script.onload = () => resolve();
    script.onerror = () => {
      playerReady = null;
      script.remove();
      reject(new Error('Could not load the live video player.'));
    };
    document.head.appendChild(script);
  }).then(() =>
    customElements.whenDefined('video-stream').then(() => undefined),
  );
  return playerReady;
}

function streamUrl(channelId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/go2rtc/api/ws?src=${encodeURIComponent(channelId)}`;
}

// Live video of one channel, read from its go2rtc re-stream — never a direct camera connection.
export function LiveFeed({ channel }: { channel: VideoFeedSource }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!channel.enabled) return;
    let player: Go2rtcPlayer | null = null;
    let cancelled = false;
    setError(null);
    loadPlayer()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        // Created imperatively (not via JSX) so its properties are set on the upgraded element.
        player = document.createElement('video-stream') as Go2rtcPlayer;
        // MSE over the proxied WebSocket: works through nginx with no extra ports (go2rtc's
        // WebRTC is disabled). Video only — the cameras' audio isn't needed here.
        player.mode = 'mse';
        player.media = 'video';
        player.src = streamUrl(channel.id);
        containerRef.current.appendChild(player);
      })
      .catch((loadError: Error) => setError(loadError.message));
    // Removing the element makes the player close its connection to go2rtc.
    return () => {
      cancelled = true;
      player?.remove();
    };
  }, [channel.id, channel.enabled]);

  if (!channel.enabled) {
    return (
      <div className="live-feed live-feed-placeholder">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Channel disabled"
        />
      </div>
    );
  }
  return (
    <div className="live-feed" ref={containerRef}>
      {error && <Text type="danger">{error}</Text>}
    </div>
  );
}

// The frame exactly as the player is showing it, at the stream's native resolution.
function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error('The video has not started playing yet.'));
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')?.drawImage(video, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('Could not capture the frame.')),
      'image/jpeg',
      0.95,
    ),
  );
}

interface CapturedFrame {
  imageUrl: string;
  analysis: FrameAnalysis | null;
  error: string | null;
}

function CapturedFrameView({ frame }: { frame: CapturedFrame }) {
  const { analysis } = frame;
  return (
    <div className="live-feed">
      {analysis ? (
        // viewBox in image pixels, so the boxes stay on the faces at any rendered size.
        <svg
          className="captured-frame"
          viewBox={`0 0 ${analysis.width} ${analysis.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <image
            href={frame.imageUrl}
            width={analysis.width}
            height={analysis.height}
          />
          {analysis.faces.map((face, index) => (
            <rect
              key={index}
              x={face.box.x}
              y={face.box.y}
              width={face.box.width}
              height={face.box.height}
              fill="none"
              stroke={faceColor(index)}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : (
        <img className="captured-frame" src={frame.imageUrl} alt="" />
      )}
      {!analysis && !frame.error && (
        <div className="captured-frame-overlay">
          <Spin />
        </div>
      )}
    </div>
  );
}

function FaceLegend({ frame }: { frame: CapturedFrame }) {
  if (frame.error) return <Text type="danger">{frame.error}</Text>;
  const { analysis } = frame;
  if (!analysis) return <Text type="secondary">Detecting faces…</Text>;
  if (analysis.faces.length === 0) {
    return <Text type="secondary">No faces detected in this frame.</Text>;
  }

  // A minimum of 0 means the channel's check is off.
  const belowSize = (size: number) =>
    analysis.minFaceSizePx > 0 && size < analysis.minFaceSizePx;
  const belowQuality = (quality: number) =>
    analysis.minFaceQuality > 0 && quality < analysis.minFaceQuality;

  return (
    <div className="face-legend">
      {analysis.faces.map((face, index) => (
        <div className="face-legend-item" key={index}>
          <span
            className="face-legend-swatch"
            style={{ borderColor: faceColor(index) }}
          />
          <Tooltip
            title={
              belowSize(face.sizePx)
                ? `Below the channel minimum of ${analysis.minFaceSizePx} px`
                : undefined
            }
          >
            <Text type={belowSize(face.sizePx) ? 'danger' : undefined}>
              Size {face.sizePx} px
            </Text>
          </Tooltip>
          <Tooltip
            title={
              [
                belowQuality(face.quality)
                  ? `Below the channel minimum of ${analysis.minFaceQuality}`
                  : null,
                ...face.qualityReasons,
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
          >
            <Text type={belowQuality(face.quality) ? 'danger' : undefined}>
              Quality {face.quality}
            </Text>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}

function LiveFeedModalContent({ channel }: { channel: VideoFeedSource }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [captured, setCaptured] = useState<CapturedFrame | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Bumped on every capture and resume, so a late analysis of an older frame is dropped.
  const captureIdRef = useRef(0);

  const imageUrl = captured?.imageUrl;
  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );

  const capture = async () => {
    const video = feedRef.current?.querySelector('video');
    setCaptureError(null);
    let blob: Blob;
    try {
      if (!video) throw new Error('The video has not started playing yet.');
      blob = await captureVideoFrame(video);
    } catch (error) {
      setCaptureError(
        error instanceof Error ? error.message : 'Could not capture the frame.',
      );
      return;
    }

    const captureId = ++captureIdRef.current;
    setCaptured({
      imageUrl: URL.createObjectURL(blob),
      analysis: null,
      error: null,
    });
    try {
      const analysis = await videoFeedSourcesApi.analyzeFrame(channel.id, blob);
      if (captureId !== captureIdRef.current) return;
      setCaptured((current) => current && { ...current, analysis });
    } catch (error) {
      if (captureId !== captureIdRef.current) return;
      const message =
        error instanceof Error ? error.message : 'Face detection failed.';
      setCaptured((current) => current && { ...current, error: message });
    }
  };

  const resume = () => {
    captureIdRef.current++;
    setCaptured(null);
  };

  return (
    <>
      {/* Kept mounted (just hidden) while a frame is shown, so resuming is instant. */}
      <div ref={feedRef} hidden={!!captured}>
        <LiveFeed channel={channel} />
      </div>
      {captured && (
        <>
          <CapturedFrameView frame={captured} />
          <div className="face-legend-container">
            <FaceLegend frame={captured} />
          </div>
        </>
      )}
      <div className="live-feed-actions">
        {captureError && <Text type="danger">{captureError}</Text>}
        {captured ? (
          <Button icon={<PlayCircleOutlined />} onClick={resume}>
            Resume video
          </Button>
        ) : (
          <Button
            icon={<CameraOutlined />}
            disabled={!channel.enabled}
            onClick={capture}
          >
            Capture frame
          </Button>
        )}
      </div>
    </>
  );
}

export function LiveFeedModal({
  channel,
  onClose,
}: {
  channel: VideoFeedSource | null;
  onClose: () => void;
}) {
  return (
    <Modal
      title={channel ? `Live — ${channel.name}` : 'Live'}
      open={!!channel}
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnHidden
    >
      {channel && <LiveFeedModalContent channel={channel} />}
    </Modal>
  );
}
