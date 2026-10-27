import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, Form, InputNumber, Switch, Typography } from 'antd';
import { useEffect } from 'react';
import { configurationApi } from '../api/configuration';
import {
  ErpAlertDeliveryStatus,
  ErpSyncStatus,
} from '../components/erp-status';
import { ErpSyncNowButton } from '../components/erp-sync-now-button';

const { Title } = Typography;

interface ConfigurationFormValues {
  alertsRetentionDays: number;
  includeTestProfilesInAlerts: boolean;
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
        includeTestProfilesInAlerts: configuration.includeTestProfilesInAlerts,
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
          name="alertsRetentionDays"
          label="Alerts Retention (days)"
          rules={[{ required: true, message: 'Retention period is required' }]}
          extra="A daily job deletes alerts (and their frame images) older than this many days."
        >
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="includeTestProfilesInAlerts"
          label="Include Test Profiles in Alerts"
          valuePropName="checked"
          extra="When on, test profiles are matched by the live cameras and raise alerts like real profiles. Their alerts are tagged as tests."
        >
          <Switch />
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
