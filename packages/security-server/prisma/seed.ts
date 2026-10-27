import { PrismaClient } from '@prisma/client';
import { CONFIG_DEFINITIONS } from '../src/configuration/configuration.schema';

const prisma = new PrismaClient();

// Seeds one row per known configuration key, using its registry default and display name.
// Idempotent: existing rows (or ones with a user-set value) are left untouched.
async function seedConfiguration() {
  await Promise.all(
    Object.entries(CONFIG_DEFINITIONS).map(([key, definition]) =>
      prisma.configuration.upsert({
        where: { key },
        update: {},
        create: {
          key,
          displayName: definition.displayName,
          value: definition.default,
        },
      }),
    ),
  );
}

async function main() {
  await seedConfiguration();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
