'use client';
import { useMemo, useRef } from 'react';
import { parseCommand, parseInput } from '@/lib/parser';
import { todaysSet } from '@/lib/client/store';
import { fmtDay, parseISO, PRI_GLYPH, PRI_LABEL, todayISO } from '@/lib/client/util';
import { STATUS_NAMES, type Priority, type Status } from '@/lib/types';
import { useDayflow, useUI } from './ctx';
import { useNow } from './hooks';
import { Icon } from './Icons';

interface ChipData { status?: Status | null; priority?: Priority | null; due?: string | null; assignee?: string | null; tags?: string[]; project?: string | null; blockedReason?: string | null }

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

export function Hero() {
  const s = useDayflow();
  const ui = useUI();
  const input = useRef<HTMLInputElement>(null);
  const shake = useRef<HTMLFormElement>(null);
  useNow(60000);

  const set = useMemo(() => todaysSet(s), [s]);
  const now = new Date();
  const h = now.getHours();
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const done = set.filter((t) => t.status === 4).length;
  const dueToday = set.filter((t) => t.dueDate === todayISO() && t.status !== 4).length;
  const pct = set.length ? Math.round((done / set.length) * 100) : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ui.capture.text.trim()) { input.current?.focus(); return; }
    if (!ui.capture.commit(ui.capture.text, 'typed')) {
      shake.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    }
  };

  return (
    <section className="hero">
      <div className="hero-head">
        <div>
          <p className="eyebrow">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}{dueToday ? ` · ${dueToday} due today` : ''}</p>
          <h1 className="greet">{part}, {s.me.name.split(' ')[0]}</h1>
        </div>
        {set.length > 0 && (
          <div className="today" title={`${done} of ${set.length} of today's tasks done`}>
            <span className="today-n"><b>{done}</b> / {set.length} done</span>
            <span className="today-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
          </div>
        )}
      </div>

      <form ref={shake} className="capture" autoComplete="off" onSubmit={submit}>
        <label htmlFor="captureInput" className="sr-only">Add a task</label>
        <input
          id="captureInput"
          ref={input}
          type="text"
          enterKeyHint="done"
          maxLength={2000}
          value={ui.capture.text}
          onChange={(e) => ui.capture.setText(e.target.value)}
          placeholder={ui.phone ? 'Add a task…' : 'Add a task… “Fix checkout bug, urgent, by Friday”'}
          aria-describedby="parsePreview"
        />
        <button type="button" className="cap-btn" title="Full form: description, links and files (T)" aria-label="Open full task form (T)"
          onClick={() => { const title = ui.capture.text.trim(); ui.capture.setText(''); ui.openComposer({ title }); }}>
          <Icon name="i-edit" />
        </button>
        <button
          type="button"
          className={`mic${ui.voice.listening ? ' listening' : ''}${ui.voice.supported ? '' : ' unsupported'}`}
          onClick={ui.voice.toggle}
          aria-pressed={ui.voice.listening}
          aria-label={ui.voice.listening ? 'Stop listening' : 'Add by voice (V)'}
          title={ui.voice.supported ? 'Add by voice (V)' : 'Voice needs Chrome, Edge or Safari. Typing always works.'}
        >
          <span className="mic-ring r1" /><span className="mic-ring r2" />
          <Icon name="i-mic" />
        </button>
        <button type="submit" className="add-btn" aria-label="Add task"><Icon name="i-plus" /></button>
      </form>
      <Preview text={ui.capture.text} />
      {ui.voice.status && <div className={`voice-status${ui.voice.status.error ? ' error' : ''}`} role="status">{ui.voice.listening ? <span className="live">{ui.voice.status.msg}</span> : ui.voice.status.msg}</div>}
      {!ui.voice.status && !ui.voice.listening && ui.voice.wake === 'on' && (
        <p className="wake-hint"><span className="wake-dot" aria-hidden="true" />Hands-free is on. Say <b>“Hey Dayflow”</b>, then a task.</p>
      )}
    </section>
  );
}
