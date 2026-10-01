'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCommand, parseInput } from '@/lib/parser';
import { focusSince, progress, streak, todaysSet } from '@/lib/client/store';
import { copyText, fmtDay, fmtDuration, parseISO, PRI_GLYPH, PRI_LABEL, startOfToday, todayISO } from '@/lib/client/util';
import { toast } from '@/lib/client/bus';
import { STATUS_NAMES, type Priority, type Status } from '@/lib/types';

interface ChipData { status?: Status | null; priority?: Priority | null; due?: string | null; assignee?: string | null; tags?: string[]; project?: string | null; blockedReason?: string | null }
import { useDayflow, useStore, useUI } from './ctx';
import { useNow } from './hooks';
import { Icon } from './Icons';
import { Orb } from './Orb';

function Chips({ p }: { p: ChipData }) {
  return (
    <>
      {p.status != null && <span className="mini"><Icon name={`s${p.status}`} style={{ color: `var(--st${p.status})` }} />{STATUS_NAMES[p.status]}</span>}
      {p.priority && <span className="mini">{PRI_GLYPH[p.priority]} {PRI_LABEL[p.priority]}</span>}
      {p.due && <span className="mini"><Icon name="i-cal" />{fmtDay(parseISO(p.due))}</span>}
      {p.assignee && <span className="mini">@{p.assignee}</span>}
      {(p.tags || []).map((t) => <span key={t} className="tagc">#{t}</span>)}
      {p.project && <span className="mini">{p.project}</span>}
      {p.blockedReason && <span className="mini">⛔ {p.blockedReason}</span>}
    </>
  );
}

function Preview({ text }: { text: string }) {
  const s = useDayflow();
  const names = useMemo(() => s.members.map((m) => m.name), [s.members]);
  const t = text.trim();
  if (!t) return <div className="parse-preview" id="parsePreview" aria-live="polite" />;
  if (/^(undo|scratch that|cancel that|oops)$/i.test(t)) return <div className="parse-preview" id="parsePreview" aria-live="polite"><span className="pp-arrow">↺</span> Undo last change</div>;
  const opts = { team: names, now: new Date() };
  const cmd = parseCommand(t, s.tasks, opts);
  if (cmd) {
    return (
      <div className="parse-preview" id="parsePreview" aria-live="polite">
        {cmd.taskId ? (
          <>
            <span className="pp-arrow">↻ Update</span><span className="pp-title">“{cmd.title}”</span><Chips p={cmd.changes} />
            {cmd.timer && <span className="mini">{cmd.timer === 'start' ? 'start focus' : 'pause focus'}</span>}
          </>
        ) : <><span className="pp-arrow">⏸</span> Pause focus timer</>}
      </div>
    );
  }
  const parsed = parseInput(t, opts);
  return (
    <div className="parse-preview" id="parsePreview" aria-live="polite">
      {parsed.length > 1 && <span className="mini"><b>{parsed.length} tasks</b></span>}
      {parsed.map((p, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span className="pp-arrow">→</span><span className="pp-title">{p.title}</span><Chips p={p} />
        </span>
      ))}
    </div>
  );
}

function DayBanner() {
  const s = useDayflow();
  const ui = useUI();
  const [kind, setKind] = useState<'welcome' | 'newday' | null>(null);
  useEffect(() => {
    const key = `dayflow.lastOpen.${s.me.id}`;
    let prev: string | null = null;
    try { prev = localStorage.getItem(key); localStorage.setItem(key, todayISO()); } catch { /* ignore */ }
    if (!prev) setKind('welcome');
    else if (prev !== todayISO()) setKind('newday');
    // Decide once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!kind) return null;
  const close = () => setKind(null);
  const code = s.org.inviteCode;
  const link = code && typeof window !== 'undefined' ? `${location.origin}/signup?invite=${code}` : '';
  const myTeams = s.me.teams.map((m) => s.teams.find((t) => t.id === m.teamId)?.name).filter(Boolean) as string[];

  if (kind === 'welcome' && s.org.kind === 'personal') {
    return (
      <div className="day-banner">
        <Icon name="i-sparkle" style={{ color: 'var(--accent)' }} />
        <span>
          Welcome to <b>your space</b>. Everything here is private to you. Work through the getting-started cards, or press <kbd>Ctrl</kbd> <kbd>K</kbd> to do anything.
        </span>
        <button className="link-btn" onClick={() => { close(); ui.openTeamUp(); }}>Create a team</button>
        <button className="icon-btn" onClick={close} aria-label="Dismiss"><Icon name="i-x" /></button>
      </div>
    );
  }
  if (kind === 'welcome') {
    return (
      <div className="day-banner">
        <Icon name="i-sparkle" style={{ color: 'var(--accent)' }} />
        <span>
          Welcome to <b>{s.org.name}</b>{myTeams.length ? <> · you are in <b>{myTeams.join(', ')}</b></> : null}. Tap the mic and say a few tasks, or press <kbd>?</kbd> for tips.
          {code ? <> Invite people with code <b>{code}</b>.</> : null}
        </span>
        {code
          ? <button className="link-btn" onClick={async () => toast((await copyText(link)) ? 'Invite link copied' : link, { icon: 'i-user-plus' })}>Copy invite link</button>
          : <button className="link-btn" onClick={() => { close(); ui.openOrg('teams'); }}>See your teams</button>}
        <button className="icon-btn" onClick={close} aria-label="Dismiss"><Icon name="i-x" /></button>
      </div>
    );
  }
  const mine = todaysSet(s).filter((t) => t.status !== 4);
  const blocked = mine.filter((t) => t.status === 2).length;
  const dueToday = mine.filter((t) => t.dueDate === todayISO()).length;
  const oldDone = s.tasks.filter((t) => t.status === 4 && t.doneAt && t.doneAt < startOfToday()).length;
  return (
    <div className="day-banner">
      <Icon name="i-sparkle" style={{ color: 'var(--accent)' }} />
      <span>New day. <b>{mine.length}</b> of yours carried over{blocked ? <> · <b>{blocked}</b> blocked</> : null}{dueToday ? <> · <b>{dueToday}</b> due today</> : null}.</span>
      {oldDone > 0 && <button className="link-btn" onClick={() => { ui.clearDone(); close(); }}>Clear {oldDone} done from before</button>}
      <button className="link-btn" onClick={() => { ui.voice.start(); close(); }}>Plan by voice</button>
      <button className="icon-btn" onClick={close} aria-label="Dismiss"><Icon name="i-x" /></button>
    </div>
  );
}

export function Hero() {
  const s = useDayflow();
  const store = useStore();
  const ui = useUI();
  const input = useRef<HTMLInputElement>(null);
  const shake = useRef<HTMLFormElement>(null);
  const running = !!s.me.timer;
  useNow(running ? 1000 : 60000);

  const set = useMemo(() => todaysSet(s), [s]);
  const p = progress(s);
  const now = new Date();
  const h = now.getHours();
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const open = set.filter((t) => t.status !== 4).length;
  const dueToday = set.filter((t) => t.dueDate === todayISO() && t.status !== 4).length;
  const focus = focusSince(s, startOfToday(), store.timerElapsed());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ui.capture.text.trim()) { input.current?.focus(); return; }
    if (!ui.capture.commit(ui.capture.text, 'typed')) {
      shake.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    }
  };

  return (
    <section className="hero">
      <div className="hero-left">
        <p className="eyebrow">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {open} open{dueToday ? ` · ${dueToday} due today` : ''}</p>
        <h1 className="greet">{part}, <span className="grad">{s.me.name.split(' ')[0]}</span></h1>
        <DayBanner />
        <form ref={shake} className="capture glass" autoComplete="off" onSubmit={submit}>
          <label htmlFor="captureInput" className="sr-only">Add a task</label>
          <div className="capture-field">
            <Icon name="i-sparkle" className="cap-ico" />
            <input
              id="captureInput"
              ref={input}
              type="text"
              enterKeyHint="done"
              maxLength={2000}
              value={ui.capture.text}
              onChange={(e) => ui.capture.setText(e.target.value)}
              placeholder={ui.phone ? 'Type a task, or tap the mic…' : 'Type or speak a task… “Fix checkout bug, urgent, by Friday”'}
              aria-describedby="parsePreview"
            />
            <span className="kbd-hint" aria-hidden="true">Enter</span>
          </div>
          <button
            type="button"
            className={`mic${ui.voice.listening ? ' listening' : ''}${ui.voice.supported ? '' : ' unsupported'}`}
            onClick={ui.voice.toggle}
            aria-pressed={ui.voice.listening}
            aria-label={ui.voice.listening ? 'Stop listening' : 'Add by voice (V)'}
            title={ui.voice.supported ? undefined : 'Voice needs Chrome, Edge or Safari. Typing always works.'}
          >
            <span className="mic-ring r1" /><span className="mic-ring r2" />
            <Icon name="i-mic" />
          </button>
          <button type="submit" className="add-btn btn-3d" aria-label="Add task"><Icon name="i-plus" /></button>
        </form>
        <Preview text={ui.capture.text} />
        {ui.voice.status && <div className={`voice-status${ui.voice.status.error ? ' error' : ''}`} role="status">{ui.voice.listening ? <span className="live">{ui.voice.status.msg}</span> : ui.voice.status.msg}</div>}
        {!ui.voice.status && !ui.voice.listening && ui.voice.wake === 'on' && (
          <p className="wake-hint"><span className="wake-dot" aria-hidden="true" />Hands-free is on. Say <b>“Hey Dayflow”</b>, then a task or the story of your day.</p>
        )}
        {!ui.voice.status && !ui.voice.listening && ui.voice.wake === 'waiting' && (
          <p className="wake-hint off">Tap the mic once and allow it to turn on hands-free <b>“Hey Dayflow”</b>.</p>
        )}
        <div className="try-row">
          <span>Try</span>
          {[
            ['3 tasks in one go', 'Fix login crash urgent in progress next task Send invoice by Friday next task Design review blocked by missing specs'],
            ['“mark login crash as done”', 'mark login crash as done'],
            ['#tag @assign dates', `Plan offsite #team assign to ${s.members.find((m) => m.id !== s.me.id)?.name.split(' ')[0] || s.me.name.split(' ')[0]} tomorrow low priority`]
          ].map(([label, say]) => (
            <button key={label} type="button" className="try" onClick={() => { ui.capture.setText(say); input.current?.focus(); }}>{label}</button>
          ))}
          <button type="button" className="try try-full" title="Description, remarks, links and files (T)"
            onClick={() => { const title = ui.capture.text.trim(); ui.capture.setText(''); ui.openComposer({ title }); }}>
            <Icon name="i-clip" />Full form
          </button>
        </div>
      </div>

      <div className="hero-right">
        <Orb tasks={set} progress={p} focusId={s.me.timer?.taskId ?? null} reduced={ui.flat} dark={ui.dark} />
        <div className="hero-stats">
          <div className="stat"><Icon name="s4" /><b>{set.filter((t) => t.status === 4).length}/{set.length}</b><span>done</span></div>
          <div className="stat"><Icon name="i-clock" /><b>{fmtDuration(focus)}</b><span>focus</span></div>
          <div className="stat"><Icon name="i-flame" /><b>{streak(s)}</b><span>day streak</span></div>
        </div>
      </div>
    </section>
  );
}
