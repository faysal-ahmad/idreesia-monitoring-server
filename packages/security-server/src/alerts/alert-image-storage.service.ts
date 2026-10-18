import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, ReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_ALERT_IMAGES_DIR = '/data/alert-images';
// <uuid>.jpg — the only names save() ever produces, so anything else in a request is rejected
// outright (which also rules out path traversal).
const FILE_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

// Alert frame images live on disk rather than in Postgres; Alert.imageFile holds the file name.
// The directory is a Docker volume in development and a host folder in production.
@Injectable()
export class AlertImageStorageService implements OnModuleInit {
  private readonly logger = new Logger(AlertImageStorageService.name);
  private readonly dir = process.env.ALERT_IMAGES_DIR || DEFAULT_ALERT_IMAGES_DIR;

  async onModuleInit() {
    await mkdir(this.dir, { recursive: true });
  }

  // Written under a temp name and then renamed, so a crash mid-write never leaves a truncated .jpg.
  async save(jpeg: Uint8Array): Promise<string> {
    const fileName = `${randomUUID()}.jpg`;
    const tempPath = join(this.dir, `${fileName}.tmp`);
    await writeFile(tempPath, jpeg);
    await rename(tempPath, join(this.dir, fileName));
    return fileName;
  }

  // null for an invalid name or a missing file.
  async open(fileName: string): Promise<ReadStream | null> {
    if (!FILE_NAME_PATTERN.test(fileName)) return null;
    const filePath = join(this.dir, fileName);
    try {
      await stat(filePath);
    } catch {
      return null;
    }
    return createReadStream(filePath);
  }

  // Best effort: a file that can't be removed is only logged, so it never fails the deletion of
  // the alert rows it belonged to.
  async remove(fileNames: string[]) {
    await Promise.all(
      fileNames.map(async (fileName) => {
        if (!FILE_NAME_PATTERN.test(fileName)) return;
        try {
          await rm(join(this.dir, fileName), { force: true });
        } catch (error) {
          this.logger.warn(`Failed to delete alert image ${fileName}: ${error}`);
        }
      }),
    );
  }
}
