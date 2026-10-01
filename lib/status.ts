import type { Priority, Status, Task } from './types';

/** Fields that follow from a status change. Used by the client (optimistic) and the server (authoritative). */
export function statusFields(prev: Pick<Task, 'status' | 'blockedAt' | 'doneAt' | 'statusChangedAt'>, next: Status, now: number) {
  if (prev.status === next) return { status: next, blockedAt: prev.blockedAt, doneAt: prev.doneAt, statusChangedAt: prev.statusChangedAt };
  return {
    status: next,
    blockedAt: next === 2 ? now : null,
    doneAt: next === 4 ? now : null,
    statusChangedAt: now
  };
}

// Day progress weights per status level (Queued → Done).
export const STATUS_WEIGHT = [0, 0.4, 0.3, 0.8, 1];
export const PRIORITY_WEIGHT: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

export function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${Math.max(0, Math.floor(secs))}s`;
}
