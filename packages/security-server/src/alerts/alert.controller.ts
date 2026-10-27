import { Controller, Get, MessageEvent, Query, Sse } from '@nestjs/common';
import { interval, map, merge, Observable, takeUntil } from 'rxjs';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AlertEventsService } from './alert-events.service';
import { ListAlertsQuerySchema } from './alert.schema';
import { AlertService } from './alert.service';

const HEARTBEAT_MS = 30_000;

// Public: the Alerts page is open to everyone, not just admins.
@Public()
@Controller('alerts')
export class AlertController {
  constructor(
    private readonly service: AlertService,
    private readonly events: AlertEventsService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListAlertsQuerySchema))
    query: ReturnType<typeof ListAlertsQuerySchema.parse>,
  ) {
    return this.service.list(query);
  }

  @Get('filter-options')
  filterOptions() {
    return this.service.filterOptions();
  }

  // Server-Sent Events feed of alert changes, so the Alerts page updates live instead of polling.
  // The comment-only heartbeat keeps proxies (nginx's 60s proxy_read_timeout) from closing an
  // idle connection; browsers ignore it.
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return merge(
      this.events.events$.pipe(map(({ type, ...data }) => ({ type, data }))),
      interval(HEARTBEAT_MS).pipe(map(() => ({ comment: 'heartbeat' }))),
    ).pipe(takeUntil(this.events.shutdown$));
  }
}
