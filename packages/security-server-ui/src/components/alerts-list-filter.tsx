import { FilterOutlined } from '@ant-design/icons';
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  Flex,
  Form,
  Popover,
  Select,
  Tag,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useState } from 'react';

export interface AlertsFilter {
  profileId?: string;
  channelId?: string;
  // ISO timestamps; either end may be left open.
  from?: string;
  to?: string;
  hideTestProfiles: boolean;
}

// The form edits the time range as one RangePicker value rather than two ISO strings.
interface AlertsFilterFormValues {
  profileId?: string;
  channelId?: string;
  timeRange?: [Dayjs | null, Dayjs | null] | null;
  hideTestProfiles?: boolean;
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
  key: 'profileId' | 'channelId' | 'timeRange' | 'hideTestProfiles';
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

const TIME_FORMAT = 'YYYY-MM-DD HH:mm';

const formatTime = (iso: string) => dayjs(iso).format(TIME_FORMAT);

// The "last ..." presets only fix the start, leaving the end open so alerts arriving after the
// filter is applied still show up.
const TIME_RANGE_PRESETS: {
  label: string;
  value: () => [Dayjs, Dayjs | null];
}[] = [
  { label: 'Last hour', value: () => [dayjs().subtract(1, 'hour'), null] },
  { label: 'Last 24 hours', value: () => [dayjs().subtract(24, 'hour'), null] },
  { label: 'Last 7 days', value: () => [dayjs().subtract(7, 'day'), null] },
  { label: 'Last 30 days', value: () => [dayjs().subtract(30, 'day'), null] },
  { label: 'Today', value: () => [dayjs().startOf('day'), null] },
  {
    label: 'Yesterday',
    value: () => [
      dayjs().subtract(1, 'day').startOf('day'),
      dayjs().subtract(1, 'day').endOf('day'),
    ],
  },
];

const timeRangeLabel = (from?: string, to?: string) => {
  if (from && to) return `${formatTime(from)} – ${formatTime(to)}`;
  if (from) return `Since ${formatTime(from)}`;
  return to ? `Until ${formatTime(to)}` : '';
};

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
  if (filter.from || filter.to) {
    chips.push({
      key: 'timeRange',
      label: 'Time',
      value: timeRangeLabel(filter.from, filter.to),
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

  const clearChip = (key: FilterChip['key']) => {
    if (key === 'hideTestProfiles') {
      setFilter({ ...filter, hideTestProfiles: false });
    } else if (key === 'timeRange') {
      setFilter({ ...filter, from: undefined, to: undefined });
    } else {
      setFilter({ ...filter, [key]: undefined });
    }
  };

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
  const [form] = Form.useForm<AlertsFilterFormValues>();
  const [open, setOpen] = useState(false);
  const activeFilterCount = getAlertsFilterChips(props).length;

  const handleFinish = (values: AlertsFilterFormValues) => {
    const [from, to] = values.timeRange ?? [];
    setFilter({
      profileId: values.profileId || undefined,
      channelId: values.channelId || undefined,
      // Whole minutes, as shown in the picker; the end includes all of its last minute.
      from: from?.startOf('minute').toISOString(),
      to: to?.endOf('minute').toISOString(),
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
        <Form.Item name="timeRange" label="Time" {...formItemLayout}>
          <DatePicker.RangePicker
            showTime={{
              format: 'HH:mm',
              defaultOpenValue: [dayjs().startOf('day'), dayjs().endOf('day')],
            }}
            format={TIME_FORMAT}
            allowEmpty={[true, true]}
            presets={TIME_RANGE_PRESETS}
            placeholder={['Any time', 'Now']}
            style={{ width: '100%' }}
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
        if (nextOpen) {
          form.setFieldsValue({
            profileId: filter.profileId,
            channelId: filter.channelId,
            timeRange:
              filter.from || filter.to
                ? [
                    filter.from ? dayjs(filter.from) : null,
                    filter.to ? dayjs(filter.to) : null,
                  ]
                : null,
            hideTestProfiles: filter.hideTestProfiles,
          });
        }
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
