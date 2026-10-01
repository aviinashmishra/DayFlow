// Tiny app-wide channels for toasts, screen-reader announcements, the
// blocked-reason prompt and confetti, so any component can trigger them.
import type { Task } from '../types';

export interface ToastAction { label: string; fn: () => void }
export interface ToastItem { id: number; msg: string; icon?: string; actions: ToastAction[]; timeout: number }

type Fn<T> = (v: T) => void;
function channel<T>() {
  const subs = new Set<Fn<T>>();
  return {
    emit: (v: T) => subs.forEach((f) => f(v)),
    on: (f: Fn<T>) => { subs.add(f); return () => { subs.delete(f); }; }
  };
}

export const toastChannel = channel<ToastItem>();
let toastId = 0;
export function toast(msg: string, opts: { icon?: string; actions?: ToastAction[]; undo?: () => void; timeout?: number } = {}) {
  const actions = [...(opts.actions || [])];
  if (opts.undo) actions.unshift({ label: 'Undo', fn: opts.undo });
  toastChannel.emit({ id: ++toastId, msg, icon: opts.icon, actions, timeout: opts.timeout || 4500 });
}

export const announceChannel = channel<string>();
export const announce = (msg: string) => announceChannel.emit(msg);

export interface ReasonRequest { task: Pick<Task, 'title' | 'blockedReason'>; resolve: (v: string | null) => void }
export const reasonChannel = channel<ReasonRequest>();
export function askBlockedReason(task: Pick<Task, 'title' | 'blockedReason'>): Promise<string | null> {
  return new Promise((resolve) => reasonChannel.emit({ task, resolve }));
}

export interface ConfettiRequest { x: number; y: number; count?: number }
export const confettiChannel = channel<ConfettiRequest>();
export const confetti = (x: number, y: number, count?: number) => confettiChannel.emit({ x, y, count });
