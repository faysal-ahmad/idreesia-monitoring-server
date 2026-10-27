-- Restructure Configuration from a fixed-id singleton row into a generic key-value store,
-- so new settings can be added as rows instead of new columns.

-- CreateTable
CREATE TABLE "security_server"."Configuration_new" (
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configuration_new_pkey" PRIMARY KEY ("key")
);

-- Migrate the existing singleton row's values into the new key-value shape.
INSERT INTO "security_server"."Configuration_new" ("key", "displayName", "value", "updatedAt")
SELECT 'alertsRetentionDays', 'Alerts Retention (days)', to_jsonb("alertsRetentionDays"), CURRENT_TIMESTAMP
FROM "security_server"."Configuration"
WHERE "id" = 'default'
UNION ALL
SELECT 'includeTestProfilesInAlerts', 'Include Test Profiles in Alerts', to_jsonb("includeTestProfilesInAlerts"), CURRENT_TIMESTAMP
FROM "security_server"."Configuration"
WHERE "id" = 'default';

-- DropTable
DROP TABLE "security_server"."Configuration";

-- RenameTable
ALTER TABLE "security_server"."Configuration_new" RENAME TO "Configuration";

-- RenameConstraint
ALTER TABLE "security_server"."Configuration" RENAME CONSTRAINT "Configuration_new_pkey" TO "Configuration_pkey";
