'use client';
import { useEffect, useRef } from 'react';
import { toast } from '@/lib/client/bus';
import { clock, haptic } from '@/lib/client/util';
import { useDayflow, useStore, useUI } from './ctx';
import { useNow } from './hooks';
import { Cube, Icon } from './Icons';
import { Avatar } from './TaskCard';
import { BellButton } from './Notifications';

function SyncPill() {
  const s = useDayflow();
  const store = useStore();
  const state = !s.online ? 'offline' : s.pending ? 'saving' : 'synced';
  const text = state === 'offline' ? `Offline${s.pending ? ` · ${s.pending} queued` : ''}` : state === 'saving' ? 'Saving…' : 'Synced';
  const title = state === 'offline' ? 'Changes are kept on this device and sync when you are back online.' : state === 'saving' ? 'Saving your changes' : 'All changes saved';
  return (
    <button className={`sync-pill ${state}`} title={title} aria-live="polite" onClick={() => { void store.flush().then(() => store.refresh()); }}>
      <i aria-hidden="true" /><span>{text}</span>
    </button>
  );
}

/** Shows ⌘ on Apple keyboards, Ctrl elsewhere. */
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function TopBar() {
  const s = useDayflow();
  const store = useStore();
  const ui = useUI();
  const personal = s.org.kind === 'personal';
  return (
    <header className="topbar">
      <div className="brand">
        <Cube />
        <span className="brand-name">Dayflow</span>
      </div>
      <nav className="view-tabs" role="tablist" aria-label="Views">
        <button role="tab" className="vtab" aria-selected={ui.view === 'board'} onClick={() => ui.setView('board')}><Icon name="i-board" /><span>Board</span></button>
        <button role="tab" className="vtab" aria-selected={ui.view === 'mine'} onClick={() => ui.setView('mine')}><Icon name="i-list" /><span>My tasks</span></button>
        <button role="tab" className="vtab" aria-selected={ui.view === 'org'} onClick={() => ui.openOrg(ui.orgTab)}><Icon name={personal ? 'i-chart' : 'i-org'} /><span>{personal ? 'Insights' : 'Organization'}</span></button>
      </nav>
      <div className="top-actions">
        <button className="cmdk-btn" onClick={ui.openPalette} aria-label="Search or run a command (Ctrl K)" title="Search or run a command">
          <Icon name="i-search" /><span className="cmdk-text">Search or do anything</span><kbd>{isMac() ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <SyncPill />
        <BellButton />
        <button className="btn btn-3d btn-primary" id="standupBtn" title="Copy standup (S)" onClick={ui.copyStandup}><Icon name="i-copy" /><span>Copy standup</span></button>
        <button className="icon-btn" aria-label={ui.dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => store.updateSettings({ theme: ui.dark ? 'light' : 'dark' })}>
          <Icon name={ui.dark ? 'i-sun' : 'i-moon'} />
        </button>
        <button className="icon-btn" id="helpBtn" aria-label="Shortcuts and voice tips (?)" onClick={ui.openHelp}><Icon name="i-help" /></button>
        <button className="me-btn" id="settingsBtn" aria-label="Account and settings" onClick={ui.openSettings}>
          <Avatar name={s.me.name} /><span>{s.me.name.split(' ')[0]}</span>
        </button>
      </div>
    </header>
  );
}

export function BottomNav() {
  const personal = useDayflow().org.kind === 'personal';
  const ui = useUI();
  return (
    <nav className="bottom-nav" aria-label="Quick actions">
      <button className="bn" aria-current={ui.view === 'board' ? 'page' : undefined} onClick={() => ui.setView('board')}><Icon name="i-board" /><span>Board</span></button>
      <button className="bn" aria-current={ui.view === 'mine' ? 'page' : undefined} onClick={() => ui.setView('mine')}><Icon name="i-list" /><span>My tasks</span></button>
      <button className={`bn-mic${ui.voice.listening ? ' listening' : ''}`} aria-label={ui.voice.listening ? 'Stop listening' : 'Add by voice'} aria-pressed={ui.voice.listening} onClick={ui.voice.toggle}>
        <span className="mic-ring r1" /><span className="mic-ring r2" /><Icon name="i-mic" />
      </button>
      <button className="bn" aria-current={ui.view === 'org' ? 'page' : undefined} onClick={() => ui.openOrg(ui.orgTab)}><Icon name={personal ? 'i-chart' : 'i-org'} /><span>{personal ? 'Insights' : 'Organization'}</span></button>
      <button className="bn" onClick={ui.openSettings}><Icon name="i-gear" /><span>Settings</span></button>
    </nav>
  );
}

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t0 = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.55);
    });
  } catch { /* audio unavailable */ }
}

export function FocusDock() {
  const s = useDayflow();
  const store = useStore();
  const ui = useUI();
  const timer = s.me.timer;
  const task = timer ? s.tasks.find((t) => t.id === timer.taskId) : undefined;
  const now = useNow(1000, !!timer);
  const notified = useRef<number | null>(null);
  const secs = timer ? Math.max(0, Math.floor((now - timer.startedAt) / 1000)) : 0;
  const pomo = s.me.settings.pomodoro * 60;

  useEffect(() => {
    document.title = task ? `▶ ${clock(secs)} · ${task.title} — Dayflow` : 'Dayflow';
  }, [task, secs]);

  useEffect(() => {
    if (!timer || !task || !pomo || secs < pomo || notified.current === timer.startedAt) return;
    notified.current = timer.startedAt;
    chime();
    haptic(s.me.settings.haptics, [30, 80, 30]);
    toast(`${s.me.settings.pomodoro} minutes of focus on “${task.title}”. Take a short break?`, { icon: 'i-bolt', actions: [{ label: 'Pause', fn: () => store.stopTimer() }], timeout: 9000 });
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try { new Notification('Focus session complete', { body: task.title, icon: '/icons/icon-192.png' }); } catch { /* ignore */ }
    }
  }, [secs, pomo, timer, task, store, s.me.settings]);

  if (!timer || !task) return null;
  const frac = pomo ? Math.min(1, secs / pomo) : (secs % 3600) / 3600;
  return (
    <div className="focus-dock glass" id="focusDock">
      <div className="dock-ring" aria-hidden="true">
        <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" className="dr-track" /><circle cx="20" cy="20" r="17" className="dr-fill" style={{ strokeDashoffset: 106.8 * (1 - frac) }} /></svg>
        <Icon name="i-bolt" className="dock-bolt" />
      </div>
      <button className="dock-info" style={{ textAlign: 'left' }} onClick={() => ui.openDetail(task.id)}>
        <span className="dock-label">Focusing on</span>
        <b className="dock-title">{task.title}</b>
      </button>
      <span className="dock-time">{clock(secs)}</span>
      <button className="icon-btn" id="dockPause" aria-label="Pause focus timer" onClick={() => store.stopTimer()}><Icon name="i-pause" /></button>
      <button className="icon-btn dock-done" aria-label="Move to Review" onClick={() => ui.changeStatus(task.id, 3, { toast: true })}><Icon name="s3" /></button>
    </div>
  );
}
