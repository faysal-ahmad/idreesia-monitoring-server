import { Form, Input, Modal, Switch } from 'antd';
import { useEffect } from 'react';
import { MonitoringProfileSummary } from '../api/types';

export interface ProfileFormValues {
  name: string;
  isTest: boolean;
}

interface ProfileFormModalProps {
  open: boolean;
  profile?: MonitoringProfileSummary | null;
  defaultIsTest?: boolean;
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (values: ProfileFormValues) => void;
}

export function ProfileFormModal({
  open,
  profile,
  defaultIsTest,
  confirmLoading,
  onCancel,
  onSubmit,
}: ProfileFormModalProps) {
  const [form] = Form.useForm<ProfileFormValues>();

  useEffect(() => {
    if (!open) return;
    if (profile) {
      form.setFieldsValue({ name: profile.name, isTest: profile.isTest });
    } else {
      form.resetFields();
      form.setFieldsValue({ isTest: defaultIsTest ?? false });
    }
  }, [open, profile, defaultIsTest, form]);

  return (
    <Modal
      title={profile ? 'Edit Profile' : 'Add Profile'}
      open={open}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      onOk={() => form.validateFields().then(onSubmit)}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
          <Input placeholder="Full name" />
        </Form.Item>
        <Form.Item
          name="isTest"
          label="Test profile"
          valuePropName="checked"
          extra="Test profiles are only used for channel calibration and never trigger real alerts."
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
