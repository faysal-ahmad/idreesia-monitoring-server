import { z } from 'zod';

interface ConfigDefinition<T> {
  displayName: string;
  default: T;
  // Validates both what's persisted in Configuration.value and a client-submitted update.
  schema: z.ZodType<T>;
}

function defineConfig<T>(definition: ConfigDefinition<T>): ConfigDefinition<T> {
  return definition;
}

// Central registry of known configuration keys. The DB row for each key is untyped JSON —
// this is what gives each key its validation, display label, and default. Adding a setting
// means adding an entry here, not a migration.
export const CONFIG_DEFINITIONS = {
  alertsRetentionDays: defineConfig({
    displayName: 'Alerts Retention (days)',
    default: 7,
    schema: z.number().int().min(1),
  }),
  // Adds test profiles to the live match set, so an end-to-end test (walk past a camera, see the
  // alert) doesn't require enrolling someone on the real watch list.
  includeTestProfilesInAlerts: defineConfig({
    displayName: 'Include Test Profiles in Alerts',
    default: false,
    schema: z.boolean(),
  }),
  // How often channel and profile changes are pulled from the ERP in the background. The Sync
  // buttons on the Channels and Profiles pages pull straight away.
  erpSyncIntervalMinutes: defineConfig({
    displayName: 'ERP Sync Interval (minutes)',
    default: 5,
    schema: z.number().int().min(1),
  }),
  // How often alerts the ERP hasn't received yet are retried. New alerts are sent as soon as
  // they're raised; this only paces the retries while the ERP is unreachable.
  erpAlertRetryIntervalMinutes: defineConfig({
    displayName: 'ERP Alert Retry Interval (minutes)',
    default: 1,
    schema: z.number().int().min(1),
  }),
};

export type ConfigKey = keyof typeof CONFIG_DEFINITIONS;
export type ConfigValues = {
  [K in ConfigKey]: (typeof CONFIG_DEFINITIONS)[K]['default'];
};

export const UpdateConfigurationSchema = z.object(
  Object.fromEntries(
    Object.entries(CONFIG_DEFINITIONS).map(([key, definition]) => [
      key,
      definition.schema.optional(),
    ]),
  ) as {
    [K in ConfigKey]: z.ZodOptional<(typeof CONFIG_DEFINITIONS)[K]['schema']>;
  },
);
export type UpdateConfigurationDto = Partial<ConfigValues>;
