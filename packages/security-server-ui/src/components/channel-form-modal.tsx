import { CheckCircleOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import {
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Space,
} from 'antd';
import { useEffect } from 'react';
import { videoFeedSourcesApi } from '../api/video-feed-sources';
import { VideoFeedSource, VideoFeedSourceType } from '../api/types';

export interface ChannelFormValues {
  name: string;
  type: VideoFeedSourceType;
  enabled: boolean;
  host?: string;
  port?: number;
  path?: string;
  username?: string;
  password?: string;
  deviceIndex?: string;
  similarityThreshold?: number | null;
  recognitionFps?: number;
}

const CONNECTION_FIELDS: (keyof ChannelFormValues)[] = [
  'type',
  'host',
  'port',
  'path',
  'username',
  'password',
  'deviceIndex',
];

export function toApiInput(values: ChannelFormValues) {
  const config =
    values.type === 'RTSP'
      ? {
          host: values.host!,
          port: values.port!,
          path: values.path ?? '',
          username: values.username,
          password: values.password,
        }
      : {
          deviceIndex:
            values.deviceIndex && /^\d+$/.test(values.deviceIndex)
              ? Number(values.deviceIndex)
              : values.deviceIndex!,
        };
  return {
    name: values.name,
    type: values.type,
    enabled: values.enabled,
    config,
  };
}

interface ChannelFormModalProps {
  open: boolean;
  channel?: VideoFeedSource | null;
  confirmLoading?: boolean;
  togglingEnabled?: boolean;
  onCancel: () => void;
  onSubmit: (values: ChannelFormValues) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
}

export function ChannelFormModal({
  open,
  channel,
  confirmLoading,
  togglingEnabled,
  onCancel,
  onSubmit,
  onToggleEnabled,
}: ChannelFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ChannelFormValues>();
  const type = Form.useWatch('type', form);
  const enabled = Form.useWatch('enabled', form);

  useEffect(() => {
    if (!open) return;
    if (channel) {
      form.setFieldsValue({
        name: channel.name,
        type: channel.type,
        enabled: channel.enabled,
        host: channel.config.host,
        port: channel.config.port,
        path: channel.config.path,
        username: channel.config.username,
        deviceIndex:
          channel.config.deviceIndex !== undefined
            ? String(channel.config.deviceIndex)
            : undefined,
        similarityThreshold: channel.similarityThreshold,
        recognitionFps: channel.recognitionFps,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ type: 'USB', enabled: true, port: 554 });
    }
  }, [open, channel, form]);

  // Verifies what's currently entered, before saving. Blank/redacted credentials on an
  // existing channel fall back to its stored ones on the server.
  const verifyMutation = useMutation({
    mutationFn: videoFeedSourcesApi.verify,
    onSuccess: (result) => {
      if (result.reachable) {
        message.success('Channel is reachable');
      } else {
        message.error(result.error ?? 'Channel is not reachable');
      }
    },
    onError: (error) =>
      message.error(error instanceof Error ? error.message : 'Verify failed'),
  });

  const verify = async () => {
    // Only the connection fields need to be valid to verify; name etc. can still be blank.
    await form.validateFields(CONNECTION_FIELDS);
    const { type, config } = toApiInput(form.getFieldsValue(true));
    verifyMutation.mutate({ type, config, channelId: channel?.id });
  };

  const verifyButton = (
    <Button
      icon={<CheckCircleOutlined />}
      loading={verifyMutation.isPending}
      onClick={() => verify().catch(() => undefined)}
    >
      Verify
    </Button>
  );

  return (
    <Modal
      title={channel ? 'Edit Channel' : 'Add Channel'}
      open={open}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      onOk={() => form.validateFields().then(onSubmit)}
      destroyOnHidden
      width={640}
      footer={(_, { OkBtn, CancelBtn }) =>
        channel ? (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Space>
              <Popconfirm
                title={
                  enabled ? 'Disable this channel?' : 'Enable this channel?'
                }
                onConfirm={() => {
                  form.setFieldValue('enabled', !enabled);
                  onToggleEnabled(channel.id, !enabled);
                }}
              >
                <Button loading={togglingEnabled}>
                  {enabled ? 'Disable' : 'Enable'}
                </Button>
              </Popconfirm>
              {verifyButton}
            </Space>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {verifyButton}
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        )
      }
    >
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 7 }}
        wrapperCol={{ span: 17 }}
      >
        <Form.Item name="enabled" noStyle>
          <Input type="hidden" />
        </Form.Item>
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Front door camera" />
        </Form.Item>
        <Form.Item name="type" label="Type" rules={[{ required: true }]}>
          <Radio.Group disabled={!!channel} optionType="button">
            <Radio.Button value="USB">USB</Radio.Button>
            <Radio.Button value="RTSP">RTSP</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {type === 'RTSP' && (
          <>
            <Form.Item
              name="host"
              label="Host"
              rules={[{ required: true, message: 'Host is required' }]}
            >
              <Input placeholder="192.168.1.50" />
            </Form.Item>
            <Form.Item name="port" label="Port" rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="path" label="Path">
              <Input placeholder="/stream1" />
            </Form.Item>
            <Form.Item name="username" label="Username">
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item name="password" label="Password">
              <Input.Password
                autoComplete="new-password"
                placeholder={channel ? 'Leave blank to keep current' : ''}
              />
            </Form.Item>
          </>
        )}

        {type === 'USB' && (
          <Form.Item
            name="deviceIndex"
            label="Device index or path"
            rules={[
              { required: true, message: 'Device index or path is required' },
            ]}
            extra="A number (e.g. 0) for the default webcam, or a device path like /dev/video0."
          >
            <Input placeholder="0" />
          </Form.Item>
        )}

        {/* Edit only: tuned once a channel is running (e.g. a threshold needs measured scores). */}
        {channel && (
          <>
            <Divider />
            <Form.Item
              name="recognitionFps"
              label="Recognition rate (fps)"
              rules={[
                { required: true, message: 'Recognition rate is required' },
              ]}
              extra="Frames per second analyzed for faces. Higher catches people passing quickly but uses more CPU."
            >
              <InputNumber
                min={0.1}
                max={30}
                step={1}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item
              name="similarityThreshold"
              label="Similarity threshold"
              extra="Minimum cosine similarity for a face on this channel to raise an alert. Leave blank to use the default (0.36)."
            >
              <InputNumber
                min={0}
                max={1}
                step={0.01}
                placeholder="Default"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}
