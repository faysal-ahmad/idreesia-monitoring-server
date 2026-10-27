import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { AlertListItem } from './alert.service';

export type AlertEvent =
  | { type: 'created'; alert: AlertListItem }
  // Bulk deletes (retention purge, the ERP sync removing a profile or channel with its alerts) — clients refetch the list
  // rather than being sent every removed id.
  | { type: 'resync' };

// In-process fan-out of alert changes to every open /alerts/stream connection. There's a single
// server instance, so an rxjs Subject is enough — no external message broker.
@Injectable()
export class AlertEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<AlertEvent>();
  private readonly shutdown = new Subject<void>();
  readonly events$: Observable<AlertEvent> = this.subject.asObservable();
  // Fires once on app shutdown. SSE responses never end on their own, and Nest's graceful
  // shutdown waits for open connections — so streams must end here or every restart hangs
  // while an Alerts page is open. Browsers then reconnect to the new process.
  readonly shutdown$: Observable<void> = this.shutdown.asObservable();

  // Destroy hooks run before the HTTP server is closed.
  onModuleDestroy() {
    this.shutdown.next();
    this.shutdown.complete();
    this.subject.complete();
  }

  emit(event: AlertEvent) {
    this.subject.next(event);
  }
}
