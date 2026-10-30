import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Switch,
  Typography,
} from 'antd';
import { useEffect } from 'react';
import { configurationApi } from '../api/configuration';
import {
  ErpAlertDeliveryStatus,
  ErpSyncStatus,
  ErpUsageStatsDeliveryStatus,
  ERP_STATUS_QUERY_KEY,
} from '../components/erp-status';
import { ErpSyncNowButton } from '../components/erp-sync-now-button';

const { Title } = Typography;

interface ConfigurationFormValues {
  alertsRetentionDays: number;
  usageStatsIntervalSeconds: number;
  usageStatsRetentionDays: number;
  includeTestProfilesInAlerts: boolean;
  erpUrl: string;
  erpUsername: string;
  erpPassword: string;
  erpSyncIntervalMinutes: number;
  erpAlertRetryIntervalMinutes: number;
}

export default function ConfigurationPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ConfigurationFormValues>();

  const { data: configuration, isLoading } = useQuery({
    queryKey: ['configuration'],
    queryFn: configurationApi.get,
  });

  useEffect(() => {
    if (configuration) {
      form.setFieldsValue({
        alertsRetentionDays: configuration.alertsRetentionDays,
        usageStatsIntervalSeconds: configuration.usageStatsIntervalSeconds,
        usageStatsRetentionDays: configuration.usageStatsRetentionDays,
        includeTestProfilesInAlerts: configuration.includeTestProfilesInAlerts,
        erpUrl: configuration.erpUrl,
        erpUsername: configuration.erpUsername,
        erpPassword: '',
        erpSyncIntervalMinutes: configuration.erpSyncIntervalMinutes,
        erpAlertRetryIntervalMinutes:
          configuration.erpAlertRetryIntervalMinutes,
      });
    }
  }, [configuration, form]);

  const updateMutation = useMutation({
    mutationFn: configurationApi.update,
    onSuccess: () => {
      message.success('Configuration saved');
      queryClient.invalidateQueries({ queryKey: ['configuration'] });
      queryClient.invalidateQueries({ queryKey: ERP_STATUS_QUERY_KEY });
    },
    onError: (error) =>
      message.error(
        error instanceof Error ? error.message : 'Failed to save configuration',
      ),
  });

  return (
    <div>
      <Title level={3}>Configuration</Title>
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 10 }}
        wrapperCol={{ span: 14 }}
        style={{ maxWidth: 560 }}
        disabled={isLoading}
        onFinish={(values) => updateMutation.mutate(values)}
      >
        <Form.Item
          name="includeTestProfilesInAlerts"
          label="Include Test Profiles in Alerts"
          valuePropName="checked"
          extra="When on, test profiles are matched by the live cameras and raise alerts like real profiles. Their alerts are tagged as tests."
        >
          <Switch />
        </Form.Item>
        <Divider titlePlacement="start">Data Retention Configuration</Divider>
        <Form.Item
          name="alertsRetentionDays"
          label="Alerts Retention (days)"
          rules={[{ required: true, message: 'Retention period is required' }]}
          extra="A daily job deletes alerts (and their frame images) older than this many days."
        >
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="usageStatsIntervalSeconds"
          label="Usage Stats Interval (seconds)"
          rules={[
            { required: true, message: 'Interval is required' },
            {
              validator: (_, value) =>
                value == null || value === 0 || (value >= 10 && value <= 300)
                  ? Promise.resolve()
                  : Promise.reject(
                      new Error('Must be 0 (off) or from 10 to 300 seconds'),
                    ),
            },
          ]}
          extra="Length of a usage-stats window: the Usage page's figures are collected and saved once per window. 0 turns collection off."
        >
          <InputNumber
            min={0}
            max={300}
            precision={0}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item
          name="usageStatsRetentionDays"
          label="Usage Stats Retention (days)"
          rules={[{ required: true, message: 'Retention period is required' }]}
          extra={
            <>
              A daily job deletes per-minute usage stats older than this many
              days. The ERP keeps its own 5-minute rollups of them.
              <ErpUsageStatsDeliveryStatus />
            </>
          }
        >
          <InputNumber min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Divider titlePlacement="start">ERP Sync Configuration</Divider>
        <Form.Item
          name="erpUrl"
          label="ERP URL"
          rules={[
            {
              pattern: /^https?:\/\/\S+$/,
              message: 'Must be an http(s) URL',
            },
          ]}
        >
          <Input placeholder="https://erp.example.com" />
        </Form.Item>
        <Form.Item name="erpUsername" label="ERP Username">
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="erpPassword" label="ERP Password">
          <Input.Password
            autoComplete="new-password"
            placeholder={configuration?.hasErpPassword ? '••••••••' : undefined}
          />
        </Form.Item>
        <Form.Item
          label="ERP Sync Interval (minutes)"
          required
          extra={
            <>
              How often channels and profiles are synced with the ERP, both
              ways, in the background. Sync now runs it straight away.
              <ErpSyncStatus />
            </>
          }
        >
          <Flex gap={8}>
            <Form.Item
              name="erpSyncIntervalMinutes"
              noStyle
              rules={[{ required: true, message: 'Sync interval is required' }]}
            >
              <InputNumber min={1} precision={0} style={{ flex: 1 }} />
            </Form.Item>
            <ErpSyncNowButton />
          </Flex>
        </Form.Item>
        <Form.Item
          name="erpAlertRetryIntervalMinutes"
          label="ERP Alert Retry Interval (minutes)"
          rules={[{ required: true, message: 'Retry interval is required' }]}
          extra={
            <>
              Alerts are sent to the ERP as soon as they're raised. If the ERP
              can't be reached, they're retried this often until it can.
              <ErpAlertDeliveryStatus />
            </>
          }
        >
          <InputNumber min={1} precision={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item wrapperCol={{ offset: 10, span: 14 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={updateMutation.isPending}
          >
            Save
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
