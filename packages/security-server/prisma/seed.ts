import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// The seeded default webcam channel is the only VideoFeedSource row with
// removable: false, so its presence (not its name) is what makes this idempotent.
async function seedDefaultWebcam() {
  const defaultWebcam = await prisma.videoFeedSource.findFirst({
    where: { removable: false },
  });
  if (defaultWebcam) return;

  await prisma.videoFeedSource.create({
    data: {
      name: 'Default webcam',
      type: 'USB',
      config: { deviceIndex: 0 },
      enabled: false,
      removable: false,
    },
  });
}

// Fixed-id singleton row — upsert is naturally idempotent, relying on the schema's own
// column defaults (alertsRetentionDays: 7) when the row doesn't exist yet.
async function seedConfiguration() {
  await prisma.configuration.upsert({
    where: { id: 'default' },
    update: {},
    create: {},
  });
}

async function main() {
  await seedDefaultWebcam();
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
