'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { announceChannel, confettiChannel, reasonChannel, toastChannel, type ReasonRequest, type ToastItem } from '@/lib/client/bus';
import { Icon } from './Icons';

// ---------------------------------------------------------------- toasts
export function Toasts() {
  const [items, setItems] = useState<Array<ToastItem & { out?: boolean }>>([]);
  useEffect(() => toastChannel.on((t) => setItems((list) => [...list.slice(-2), t])), []);
  const dismiss = (id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, out: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 300);
  };
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => <Toast key={t.id} t={t} onDone={() => dismiss(t.id)} />)}
    </div>
  );
}

function Toast({ t, onDone }: { t: ToastItem & { out?: boolean }; onDone: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    timer.current = setTimeout(() => done.current(), t.timeout);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [t.timeout]);
  return (
    <div
      className={`toast${t.out ? ' out' : ''}`}
      onPointerEnter={() => timer.current && clearTimeout(timer.current)}
      onPointerLeave={() => { timer.current = setTimeout(() => done.current(), 2000); }}
    >
      {t.icon && <Icon name={t.icon} className="t-ico" />}
      <span>{t.msg}</span>
      {t.actions.map((a) => (
        <button key={a.label} onClick={() => { a.fn(); onDone(); }}>{a.label}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- screen reader announcements
export function Announcer() {
  const [msg, setMsg] = useState('');
  useEffect(() => announceChannel.on((m) => { setMsg(''); setTimeout(() => setMsg(m), 30); }), []);
  return <div className="sr-only" aria-live="assertive">{msg}</div>;
}

// ---------------------------------------------------------------- confetti (flat particles with a 3D flip)
interface Part { x: number; y: number; vx: number; vy: number; r: number; vr: number; s: number; c: string; life: number }
export function Confetti({ disabled }: { disabled: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const off = useRef(disabled);
  off.current = disabled;
  useEffect(() => {
    let parts: Part[] = [];
    let raf = 0;
    const loop = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.012;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.scale(1, Math.cos(p.r * 3));
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
      raf = parts.length ? requestAnimationFrame(loop) : 0;
      if (!parts.length) ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    const unsub = confettiChannel.on(({ x, y, count = 70 }) => {
      const c = ref.current;
      if (off.current || !c) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      c.width = innerWidth * dpr;
      c.height = innerHeight * dpr;
      c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cs = getComputedStyle(document.documentElement);
      const cols = [0, 1, 2, 3, 4].map((i) => cs.getPropertyValue(`--st${i}`).trim()).concat(['#ffd166', '#ff7ad9', '#6d8cff']);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7;
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, s: 5 + Math.random() * 6, c: cols[i % cols.length], life: 1 });
      }
      if (!raf) raf = requestAnimationFrame(loop);
    });
    return () => { unsub(); cancelAnimationFrame(raf); };
  }, []);
  return <canvas id="fx" ref={ref} aria-hidden="true" />;
}

// ---------------------------------------------------------------- tooltip for chart marks
export function Tooltip() {
  const [tip, setTip] = useState<{ a: string; b: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!el) { setTip(null); return; }
      const [a, b] = (el.dataset.tip || '').split('|');
      const r = el.getBoundingClientRect();
      setTip({ a, b: b || '', x: r.left + r.width / 2, y: r.top });
    };
    const hide = () => setTip(null);
    document.addEventListener('pointerover', show);
    document.addEventListener('focusin', show);
    window.addEventListener('scroll', hide, { passive: true });
    return () => {
      document.removeEventListener('pointerover', show);
      document.removeEventListener('focusin', show);
      window.removeEventListener('scroll', hide);
    };
  }, []);
  if (!tip) return null;
  const x = Math.min(innerWidth - 90, Math.max(90, tip.x));
  return <div className="tip" role="tooltip" style={{ left: x, top: tip.y }}><b>{tip.a}</b>{tip.b}</div>;
}

// ---------------------------------------------------------------- modal & sheet shells
export function useRestoreFocus(open: boolean) {
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (open) opener.current = document.activeElement;
    else if (opener.current && document.contains(opener.current)) (opener.current as HTMLElement).focus?.({ preventScroll: true });
  }, [open]);
}

// Esc closes only the top-most overlay.
const escStack: Array<{ current: () => void }> = [];
let escBound = false;
function bindEscape() {
  if (escBound) return;
  escBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !escStack.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    escStack[escStack.length - 1].current();
  }, true);
}
/** True while any modal or sheet is open (used by global shortcuts). */
export const overlayOpen = () => escStack.length > 0;

export function useEscape(open: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return;
    bindEscape();
    escStack.push(cb);
    return () => {
      const i = escStack.lastIndexOf(cb);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, [open]);
}

export function Modal({ open, onClose, labelledBy, wide, children }: { open: boolean; onClose: () => void; labelledBy: string; wide?: boolean; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  useRestoreFocus(open);
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const f = card.current?.querySelector<HTMLElement>('[data-autofocus], .seg button[aria-pressed="true"], .btn-primary, [data-cancel]');
      f?.focus({ preventScroll: true });
    }, 30);
    return () => clearTimeout(t);
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={card} className={`modal-card glass${wide ? ' wide' : ''}`}>{children}</div>
    </div>
  );
}

export function Sheet({ open, onClose, labelledBy, head, children }: { open: boolean; onClose: () => void; labelledBy: string; head: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ y0: number; dy: number } | null>(null);
  useRestoreFocus(open);
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('.sheet-body input, .sheet-body textarea, .sheet-body button, [data-close]')?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, [open]);
  if (!open) return null;

  // Drag the handle down to close on phones.
  const down = (e: React.PointerEvent) => {
    if (!matchMedia('(max-width: 760px)').matches || (e.target as Element).closest('button')) return;
    drag.current = { y0: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (ref.current) ref.current.style.transition = 'none';
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y0);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const up = () => {
    if (!drag.current || !ref.current) return;
    const dy = drag.current.dy;
    drag.current = null;
    ref.current.style.transition = 'transform .25s';
    ref.current.style.transform = '';
    if (dy > 110) onClose();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={ref} className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="sheet-grab" aria-hidden="true" />
          <header className="sheet-head">{head}</header>
        </div>
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- blocked reason prompt
export function BlockedModal() {
  const [req, setReq] = useState<ReasonRequest | null>(null);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => reasonChannel.on((r) => { setReq(r); setValue(r.task.blockedReason || ''); }), []);
  const finish = (v: string | null) => { req?.resolve(v); setReq(null); };
  return (
    <Modal open={!!req} onClose={() => finish(null)} labelledBy="blkTitle">
      <form
        style={{ display: 'contents' }}
        onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (!v) { input.current?.focus(); return; } finish(v); }}
      >
        <div className="modal-ico"><Icon name="s2" /></div>
        <h2 id="blkTitle">What&apos;s blocking it?</h2>
        <p className="muted">“{req?.task.title}” will appear on the team&apos;s blocked list with this note.</p>
        <div className="chips">
          {['Waiting on someone', 'Needs access', 'Needs a decision', 'Upstream bug'].map((c) => (
            <button key={c} type="button" className="chip" onClick={() => { setValue(c); input.current?.focus(); }}>{c}</button>
          ))}
        </div>
        <label htmlFor="blkReason" className="sr-only">Blocked reason</label>
        <input id="blkReason" ref={input} data-autofocus className="field" maxLength={200} placeholder="Short note, e.g. waiting on vendor keys" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => finish(null)}>Cancel</button>
          <button type="submit" className="btn btn-3d btn-danger">Mark blocked</button>
        </div>
      </form>
    </Modal>
  );
}
