import { db, uid, type LogEntry } from './db';

export const MANAGER = 'ผู้จัดการ';

export async function logEvent(
  area: LogEntry['area'],
  action: string,
  detail?: string,
  actor: string = MANAGER,
): Promise<void> {
  await db.log.add({ id: uid(), at: Date.now(), actor, area, action, detail });
}
