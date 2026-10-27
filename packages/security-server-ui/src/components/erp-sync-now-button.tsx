import { SyncOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Tooltip } from 'antd';
import { erpApi } from '../api/erp';
import { ErpSyncSummary } from '../api/types';
import { ERP_STATUS_QUERY_KEY, useErpStatus } from './erp-status';

function describe({
  pulled,
  conflicts,
  pushed,
  deferred,
}: ErpSyncSummary): string {
  const parts = [
    pulled.channels && `${pulled.channels} channel(s) from the ERP`,
    pulled.profiles && `${pulled.profiles} profile(s) from the ERP`,
    pulled.photos && `${pulled.photos} photo change(s) from the ERP`,
    pushed.channels && `${pushed.channels} channel(s) to the ERP`,
    pushed.profiles && `${pushed.profiles} profile(s) to the ERP`,
    conflicts && `${conflicts} ERP change(s) overridden by changes made here`,
    deferred &&
      `${deferred} delete(s) waiting for their alerts to reach the ERP`,
  ].filter(Boolean);
  return parts.length > 0
    ? `Synced: ${parts.join(', ')}`
    : 'Already in sync with the ERP';
}

// Runs the full two-way sync with the ERP now, instead of waiting for the next scheduled one.
export function ErpSyncNowButton() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: status } = useErpStatus();

  const syncMutation = useMutation({
    mutationFn: erpApi.sync,
    onSuccess: (summary) => {
      message.success(describe(summary));
      // Channels, profiles and the ERP status may all have changed.
      queryClient.invalidateQueries();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Sync failed');
      queryClient.invalidateQueries({ queryKey: ERP_STATUS_QUERY_KEY });
    },
  });

  const button = (
    <Button
      icon={<SyncOutlined />}
      loading={syncMutation.isPending}
      disabled={!status?.configured}
      onClick={() => syncMutation.mutate()}
    >
      Sync now
    </Button>
  );
  return status && !status.configured ? (
    <Tooltip title="The ERP connection is not configured on the server">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
