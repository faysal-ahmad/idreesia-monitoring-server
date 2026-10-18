import { FilterOutlined } from '@ant-design/icons';
import {
  Badge,
  Button,
  Checkbox,
  Flex,
  Form,
  Popover,
  Select,
  Tag,
} from 'antd';
import { useState } from 'react';

export interface AlertsFilter {
  profileId?: string;
  channelId?: string;
  hideTestProfiles: boolean;
}

export interface AlertsFilterOption {
  id: string;
  name: string;
}

export interface AlertsListFilterProps {
  filter: AlertsFilter;
  setFilter(filter: AlertsFilter): void;
  profiles: AlertsFilterOption[];
  channels: AlertsFilterOption[];
}

interface FilterChip {
  key: keyof AlertsFilter;
  label: string;
  value: string;
}

export const EMPTY_ALERTS_FILTER: AlertsFilter = { hideTestProfiles: false };

const formItemLayout = {
  labelCol: { span: 7 },
  wrapperCol: { span: 17 },
};

const nameOf = (options: AlertsFilterOption[], id: string) =>
  options.find((option) => option.id === id)?.name ?? 'Unknown';

const toSelectOptions = (options: AlertsFilterOption[]) =>
  options.map((option) => ({ value: option.id, label: option.name }));

export const getAlertsFilterChips = ({
  filter,
  profiles,
  channels,
}: AlertsListFilterProps): FilterChip[] => {
  const chips: FilterChip[] = [];
  if (filter.profileId) {
    chips.push({
      key: 'profileId',
      label: 'Monitored Person',
      value: nameOf(profiles, filter.profileId),
    });
  }
  if (filter.channelId) {
    chips.push({
      key: 'channelId',
      label: 'Channel',
      value: nameOf(channels, filter.channelId),
    });
  }
  if (filter.hideTestProfiles) {
    chips.push({
      key: 'hideTestProfiles',
      label: 'Test Profiles',
      value: 'Hidden',
    });
  }
  return chips;
};

export const AlertsListFilterChips = (props: AlertsListFilterProps) => {
  const { filter, setFilter } = props;
  const chips = getAlertsFilterChips(props);
  if (chips.length === 0) return null;

  const clearChip = (key: FilterChip['key']) =>
    setFilter(
      key === 'hideTestProfiles'
        ? { ...filter, hideTestProfiles: false }
        : { ...filter, [key]: undefined },
    );

  return (
    <Flex
      wrap="wrap"
      gap={8}
      align="center"
      justify="flex-end"
      className="list-filter-chips"
    >
      {chips.map((chip) => (
        <Tag
          key={chip.key}
          closable
          onClose={(event) => {
            event.preventDefault();
            clearChip(chip.key);
          }}
        >
          <span>
            {chip.label}: {chip.value}
          </span>
        </Tag>
      ))}
      <Button
        type="link"
        size="small"
        onClick={() => setFilter(EMPTY_ALERTS_FILTER)}
      >
        Clear all
      </Button>
    </Flex>
  );
};

const AlertsListFilter = (props: AlertsListFilterProps) => {
  const { filter, setFilter, profiles, channels } = props;
  const [form] = Form.useForm<AlertsFilter>();
  const [open, setOpen] = useState(false);
  const activeFilterCount = getAlertsFilterChips(props).length;

  const handleFinish = (values: AlertsFilter) => {
    setFilter({
      profileId: values.profileId || undefined,
      channelId: values.channelId || undefined,
      hideTestProfiles: !!values.hideTestProfiles,
    });
    setOpen(false);
  };

  const filterForm = (
    <div className="list-filter-panel">
      <Form form={form} layout="horizontal" onFinish={handleFinish}>
        <Form.Item
          name="profileId"
          label="Monitored Person"
          {...formItemLayout}
        >
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Any person"
            options={toSelectOptions(profiles)}
          />
        </Form.Item>
        <Form.Item name="channelId" label="Channel" {...formItemLayout}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Any channel"
            options={toSelectOptions(channels)}
          />
        </Form.Item>
        <Form.Item
          name="hideTestProfiles"
          valuePropName="checked"
          wrapperCol={{
            offset: formItemLayout.labelCol.span,
            span: formItemLayout.wrapperCol.span,
          }}
        >
          <Checkbox>Hide test profiles</Checkbox>
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Flex justify="flex-end">
            <Button type="primary" htmlType="submit">
              Search
            </Button>
          </Flex>
        </Form.Item>
      </Form>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) form.setFieldsValue(filter);
        setOpen(nextOpen);
      }}
      content={filterForm}
    >
      <Badge count={activeFilterCount} size="small" offset={[-2, 2]}>
        <Button icon={<FilterOutlined />}>Filter</Button>
      </Badge>
    </Popover>
  );
};

export default AlertsListFilter;
