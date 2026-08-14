import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  ping(): string {
    return 'pong';
  }

  // Placeholder heartbeat — replace with real scheduled work.
  @Interval(30_000)
  heartbeat() {
    this.logger.log('heartbeat');
  }
}
