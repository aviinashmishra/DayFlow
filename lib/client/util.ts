import type { Member, Task } from '../types';
export { fmtDuration } from '../status';

export const SHORT = ['Queued', 'Doing', 'Blocked', 'Review', 'Done'];
export const EMOJI = ['📋', '🔨', '⛔', '👀', '✅'];
export const PRI_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;
export const PRI_GLYPH = { high: '▲', medium: '◆', low: '▼' } as const;
export const EMPTY = [
  'Nothing queued. Tap the mic and plan your day.',
  'Nothing in progress. Start a focus timer on a task.',
  'Nothing blocked. Nice.',
  'Nothing waiting for review.',
  'Finish something to see it here.'
];
// Swipe / arrow-key flow skips Blocked: blocking is a deliberate act with a reason.
export const FLOW_NEXT: Record<number, number | null> = { 0: 1, 1: 3, 2: 1, 3: 4, 4: null };
export const FLOW_PREV: Record<number, number | null> = { 0: null, 1: 0, 2: 0, 3: 1, 4: 3 };

const AVATAR_COLORS = ['#2a78d6', '#d9541f', '#128a5f', '#a86e00', '#c23d72', '#0b7a0b', '#5a49c4', '#c93a3a'];
export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export const pad = (n: number) => String(n).padStart(2, '0');
export function clock(secs: number): string {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function fmtDay(d: Date | number, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Date(d).toLocaleDateString('en-GB', opts);
}
export const daysSince = (ms: number | null) => (ms ? (Date.now() - ms) / 86400000 : 0);
export function ageLabel(days: number): string {
  if (days < 1 / 24) return 'just now';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  return `${Math.floor(days)}d`;
}
export function relTime(ms: number): string {
  const d = (Date.now() - ms) / 86400000;
  if (d < 1 / 1440) return 'just now';
  if (d < 1 / 24) return `${Math.round(d * 1440)} min ago`;
  if (d < 1) return `${Math.round(d * 24)} h ago`;
  if (d < 2) return 'yesterday';
  return `${Math.floor(d)} days ago`;
}
export function dueInfo(t: Pick<Task, 'dueDate'>) {
  if (!t.dueDate) return null;
  const due = parseISO(t.dueDate);
  const diff = Math.round((due.getTime() - startOfToday()) / 86400000);
  if (diff < 0) return { cls: 'overdue', label: `Overdue · ${fmtDay(due, { day: 'numeric', month: 'short' })}`, diff };
  if (diff === 0) return { cls: 'today', label: 'Due today', diff };
  if (diff === 1) return { cls: '', label: 'Tomorrow', diff };
  if (diff < 7) return { cls: '', label: fmtDay(due, { weekday: 'short' }), diff };
  return { cls: '', label: fmtDay(due, { day: 'numeric', month: 'short' }), diff };
}
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export function memberName(members: Member[], id: string | null | undefined): string | null {
  if (!id) return null;
  return members.find((m) => m.id === id)?.name ?? 'Former member';
}
export function findMember(members: Member[], name: string | null): Member | null {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  return members.find((m) => m.name.toLowerCase() === n) || members.find((m) => m.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]) || null;
}
export function uuid(): string {
  const c = globalThis.crypto as Crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // RFC 4122 v4 fallback for older browsers / non-secure contexts.
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
export function haptic(enabled: boolean, pattern: number | number[]) {
  if (enabled && typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}

// ---------- files & links (full task form, detail sheet) ----------
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/** Adds https:// when the scheme is missing; returns null unless the result is a valid http(s) URL. */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    const web = u.protocol === 'http:' || u.protocol === 'https:';
    return web && (u.hostname.includes('.') || u.hostname === 'localhost') ? u.href : null;
  } catch {
    return null;
  }
}
export function linkHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
/** Short file-type badge text, e.g. PDF, PNG, DOCX. */
export function fileKind(name: string, mime: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  return (ext || mime.split('/')[1] || 'file').slice(0, 4).toUpperCase();
}
export const isImage = (mime: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(mime);

// ---------- due-date buckets (My tasks grouping, exports) ----------
export const DUE_BUCKETS = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No due date'] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];
export function dueBucket(dueDate: string | null): DueBucket {
  if (!dueDate) return 'No due date';
  const diff = Math.round((parseISO(dueDate).getTime() - startOfToday()) / 86400000);
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return 'This week';
  return 'Later';
}
