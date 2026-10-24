import { useQuery } from '@tanstack/react-query';
import { Badge } from 'antd';
import { channelHealthApi } from '../api/channel-health';

// Health is time-based (a channel goes offline when frames stop arriving), so it's polled
// rather than pushed over the alerts stream.
const REFRESH_INTERVAL_MS = 10_000;

// "Monitoring N channels, M are online", so a quiet Alerts page can be told apart from a dead camera.
export function ChannelHealthSummary() {
  const { data: channels } = useQuery({
    queryKey: ['channel-health'],
    queryFn: channelHealthApi.list,
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  if (!channels) return null;
  if (channels.length === 0) return <Badge status="default" text="No channels being monitored" />;

  const total = channels.length;
  const online = channels.filter((channel) => channel.status === 'online').length;
  const status = online === total ? 'success' : online === 0 ? 'error' : 'warning';
  return (
    <Badge
      status={status}
      text={`Monitoring ${total} channel${total === 1 ? '' : 's'}, ${online} ${online === 1 ? 'is' : 'are'} online`}
    />
  );
}

export default ChannelHealthSummary;
