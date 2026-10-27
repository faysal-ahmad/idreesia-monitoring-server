import { Empty, Modal, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { VideoFeedSource } from '../api/types';

const { Text } = Typography;

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
      {channel && <LiveFeed channel={channel} />}
    </Modal>
  );
}
