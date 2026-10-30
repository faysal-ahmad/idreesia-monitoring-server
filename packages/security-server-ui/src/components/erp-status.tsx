import { useQuery } from '@tanstack/react-query';
import { Typography } from 'antd';
import { erpApi } from '../api/erp';

const { Text } = Typography;

export const ERP_STATUS_QUERY_KEY = ['erp', 'status'];

export function useErpStatus() {
  return useQuery({
    queryKey: ERP_STATUS_QUERY_KEY,
    queryFn: erpApi.status,
    refetchInterval: 15_000,
  });
}

const formatTime = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'Never';

// Shown under the ERP Sync Interval setting.
export function ErpSyncStatus() {
  const { data: status } = useErpStatus();
  if (!status?.configured) return null;
  return (
    <>
      <Text style={{ display: 'block' }}>
        Last synced: {formatTime(status.lastSyncedAt)}
      </Text>
      {status.lastSyncError && (
        <Text type="danger" style={{ display: 'block' }}>
          Last sync failed: {status.lastSyncError}
        </Text>
      )}
    </>
  );
}

// Shown under the ERP Alert Retry Interval setting.
export function ErpAlertDeliveryStatus() {
  const { data: status } = useErpStatus();
  if (!status?.configured) return null;
  return (
    <>
      <Text style={{ display: 'block' }}>
        Alerts waiting for the ERP: {status.pendingAlerts}
      </Text>
      {status.lastPushError && (
        <Text type="danger" style={{ display: 'block' }}>
          Last attempt failed: {status.lastPushError}
        </Text>
      )}
    </>
  );
}

// Shown under the Usage Stats Retention setting.
export function ErpUsageStatsDeliveryStatus() {
  const { data: status } = useErpStatus();
  if (!status?.configured) return null;
  return (
    <>
      <Text style={{ display: 'block' }}>
        Usage stats sent to the ERP up to:{' '}
        {formatTime(status.usageStatsPushedUntil)}
      </Text>
      {status.lastUsageStatsPushError && (
        <Text type="danger" style={{ display: 'block' }}>
          Last attempt failed: {status.lastUsageStatsPushError}
        </Text>
      )}
    </>
  );
}
