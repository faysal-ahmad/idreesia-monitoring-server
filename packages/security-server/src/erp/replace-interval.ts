import { SchedulerRegistry } from '@nestjs/schedule';

// (Re)registers a named interval, for work whose period is an admin setting and so can change
// while the server runs.
export function replaceInterval(scheduler: SchedulerRegistry, name: string, minutes: number, run: () => void) {
  if (scheduler.doesExist('interval', name)) scheduler.deleteInterval(name);
  scheduler.addInterval(name, setInterval(run, minutes * 60_000));
}
