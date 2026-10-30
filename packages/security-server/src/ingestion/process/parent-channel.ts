import { Injectable } from '@nestjs/common';
import { ProcessToMainMessage } from './ingestion-protocol';

// The IPC channel back to the main process, typed. Messages sent once the main process is gone
// are dropped; this process exits on 'disconnect' anyway (see ingestion-process.main.ts).
@Injectable()
export class ParentChannel {
  send(message: ProcessToMainMessage) {
    if (process.connected) process.send?.(message);
  }
}
