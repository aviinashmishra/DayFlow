'use client';
import { useRef, type DragEvent } from 'react';
import { askBlockedReason } from '@/lib/client/bus';
import { ageLabel, avatarColor, clock, daysSince, dueInfo, FLOW_NEXT, FLOW_PREV, fmtDuration, initials, memberName, PRI_GLYPH, PRI_LABEL } from '@/lib/client/util';
import { STATUS_NAMES, type Member, type OrgTeam, type Status, type Task } from '@/lib/types';
import { useStore, useUI } from './ctx';
import { useNow } from './hooks';
import { Icon } from './Icons';

export function Avatar({ name, cls = '' }: { name: string; cls?: string }) {
  return (
    <span className={`avatar ${cls}`} style={{ ['--av' as string]: avatarColor(name) }} title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}

function TimerText({ startedAt }: { startedAt: number }) {
  const now = useNow(1000);
  return <>{clock((now - startedAt) / 1000)}</>;
}

interface Props {
  t: Task;
  members: Member[];
  timer: { taskId: string; startedAt: number } | null;
  isNew: boolean;
  draggable: boolean;
  onDragStart: (e: DragEvent, id: string) => void;
  onDragEnd: () => void;
  /** Shown when the board mixes teams. */
  team?: OrgTeam;
  /** Mark private tasks (only in team workspaces; in a personal space everything is private). */
  showPrivate?: boolean;
}

export function TaskCard({ t, members, timer, isNew, draggable, onDragStart, onDragEnd, team, showPrivate }: Props) {
  const ui = useUI();
  const store = useStore();
  const card = useRef<HTMLElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; dx: number; active: boolean; pid: number; target: number | null } | null>(null);
  const suppressClick = useRef(false);

  const timerOn = timer?.taskId === t.id;
  const blockedAge = t.status === 2 ? daysSince(t.blockedAt) : 0;
  const stale = blockedAge >= 2;
  const due = t.status !== 4 ? dueInfo(t) : null;
  const assignee = memberName(members, t.assigneeId);
  const label = [t.title, STATUS_NAMES[t.status], `${PRI_LABEL[t.priority]} priority`, due?.label, assignee && `assigned to ${assignee}`, t.status === 2 && t.blockedReason && `blocked: ${t.blockedReason}`].filter(Boolean).join('. ');

  // ---- 3D tilt with a glare that follows the pointer (mouse only)
  const tilt = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || ui.flat || !card.current) return;
    const el = card.current;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.classList.add('tilting');
    el.style.setProperty('--ry', `${((px - 0.5) * 12).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${((0.5 - py) * 10).toFixed(2)}deg`);
    el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
  };
  const untilt = () => {
    const el = card.current;
    if (!el) return;
    el.classList.remove('tilting');
    el.style.removeProperty('--rx');
    el.style.removeProperty('--ry');
  };

  // ---- touch swipe: right = next level, left = previous level (phone layout)
  const down = (e: React.PointerEvent) => {
    untilt();
    if (e.pointerType === 'mouse' || !ui.phone) return;
    swipe.current = { x: e.clientX, y: e.clientY, dx: 0, active: false, pid: e.pointerId, target: null };
  };
  const move = (e: React.PointerEvent) => {
    tilt(e);
    const s = swipe.current;
    if (!s || e.pointerId !== s.pid || !card.current || !hint.current) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe.current = null; return; }
      if (Math.abs(dx) < 12) return;
      s.active = true;
      try { card.current.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      card.current.style.transition = 'none';
    }
    const target = dx > 0 ? FLOW_NEXT[t.status] : FLOW_PREV[t.status];
    const eff = target === null ? dx * 0.25 : dx;
    s.dx = eff;
    s.target = target;
    const h = hint.current;
    h.className = `swipe-hint ${dx > 0 ? 'fwd' : 'back'}`;
    h.textContent = target === null ? '' : dx > 0 ? `→ ${STATUS_NAMES[target]}` : `${STATUS_NAMES[target]} ←`;
    h.style.background = target === null ? 'var(--surface-3)' : `var(--st${target})`;
    h.style.opacity = String(Math.min(1, Math.abs(eff) / 90));
    card.current.style.transform = `perspective(700px) translateX(${eff}px) rotateY(${eff / 14}deg)`;
  };
  const end = async () => {
    const s = swipe.current;
    swipe.current = null;
    const el = card.current;
    if (!s || !s.active || !el) return;
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 60);
    const reset = () => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      if (hint.current) hint.current.style.opacity = '0';
    };
    if (Math.abs(s.dx) > 85 && s.target !== null) {
      el.style.transition = 'transform .25s ease-in, opacity .25s';
      el.style.transform = `perspective(700px) translateX(${s.dx > 0 ? 120 : -120}%) rotateY(${s.dx > 0 ? 35 : -35}deg)`;
      el.style.opacity = '0';
      const ok = await ui.changeStatus(t.id, s.target as Status, { el, toast: true });
      if (!ok) reset();
    } else reset();
  };

  // ---- clicks & keyboard
  const click = async (e: React.MouseEvent) => {
    if (suppressClick.current) return;
    const target = e.target as Element;
    const lv = target.closest<HTMLElement>('[data-lv]');
    if (lv) { await ui.changeStatus(t.id, Number(lv.dataset.lv) as Status, { el: card.current }); return; }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'timer') { store.toggleTimer(t.id); return; }
    if (act === 'reason') { const r = await askBlockedReason(t); if (r) store.updateTask(t.id, { blockedReason: r }, { label: 'Blocked reason' }); return; }
    if (act === 'open' || !target.closest('button')) ui.openDetail(t.id);
  };
  const key = async (e: React.KeyboardEvent) => {
    if (e.target !== card.current) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      const to = k === 'ArrowRight' ? FLOW_NEXT[t.status] : FLOW_PREV[t.status];
      if (to === null) return;
      ui.focusAfterRender(t.id);
      if (await ui.changeStatus(t.id, to as Status, { el: card.current }) && ui.phone) ui.selectCol(to);
    } else if (/^[1-5]$/.test(k)) {
      e.preventDefault();
      ui.focusAfterRender(t.id);
      await ui.changeStatus(t.id, (Number(k) - 1) as Status, { el: card.current });
    } else if (k === ' ') {
      e.preventDefault();
      store.toggleTimer(t.id);
    } else if (k === 'Enter') {
      e.preventDefault();
      ui.openDetail(t.id);
    } else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      ui.deleteTask(t.id);
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      const cards = Array.from(card.current!.closest('.col')!.querySelectorAll<HTMLElement>('.card'));
      cards[cards.indexOf(card.current as HTMLElement) + (k === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  };

  const cls = ['card', `s-${t.status}`, `pri-${t.priority}`, timerOn && 'focused-timer', isNew && 'enter'].filter(Boolean).join(' ');

  return (
    <div className="cw" data-id={t.id}>
      <div className="swipe-hint" ref={hint} aria-hidden="true" />
      <article
        ref={card}
        className={cls}
        data-id={t.id}
        tabIndex={0}
        draggable={draggable}
        style={{ ['--sc' as string]: `var(--st${t.status})` }}
        aria-label={label}
        onClick={click}
        onKeyDown={key}
        onPointerMove={move}
        onPointerLeave={untilt}
        onPointerDown={down}
        onPointerUp={end}
        onPointerCancel={end}
        onDragStart={(e) => { untilt(); onDragStart(e, t.id); }}
        onDragEnd={onDragEnd}
      >
        <div className="card-top">
          <span className="pri"><i aria-hidden="true">{PRI_GLYPH[t.priority]}</i>{PRI_LABEL[t.priority]}</span>
          {t.source === 'voice' && <span className="src" title="Added by voice"><Icon name="i-mic" /></span>}
          <button className="icon-btn" data-act="open" aria-label="Open details"><Icon name="i-more" /></button>
        </div>
        <h3 className="card-title">{t.title}</h3>
        {t.description && <p className="card-desc">{t.description}</p>}
        {t.status === 2 && (
          <div className={`blocker${stale ? ' stale' : ''}`}>
            <Icon name="s2" />
            <div>
              {t.blockedReason ? <b>{t.blockedReason}</b> : <button className="link-btn" data-act="reason">Add blocked reason</button>}
              {' · '}{ageLabel(blockedAge)}{stale ? ' · stale' : ''}
            </div>
          </div>
        )}
        {((showPrivate && t.private) || team || assignee || due || t.tags.length > 0 || t.project || t.commentCount > 0 || t.attachmentCount > 0 || t.links.length > 0) && (
          <div className="meta">
            {showPrivate && t.private && <span className="team-chip private-chip" title="Private: only you can see this"><Icon name="i-lock" />Private</span>}
            {team && <span className="team-chip" title={`${team.name} team`}><i className="team-dot" style={{ background: team.color }} aria-hidden="true" />{team.name}</span>}
            {assignee && <Avatar name={assignee} />}
            {due && <span className={`due ${due.cls}`}><Icon name="i-cal" />{due.label}</span>}
            {t.tags.map((tag) => <span key={tag} className="tagc">#{tag}</span>)}
            {t.project && <span className="mini">{t.project}</span>}
            {t.commentCount > 0 && <span className="mini" title="Comments"><Icon name="i-comment" />{t.commentCount}</span>}
            {t.attachmentCount > 0 && <span className="mini" title="Attachments"><Icon name="i-clip" />{t.attachmentCount}</span>}
            {t.links.length > 0 && <span className="mini" title="Links"><Icon name="i-link" />{t.links.length}</span>}
          </div>
        )}
        <div className="levels-wrap">
          <div className="levels" role="group" aria-label="Status level">
            {STATUS_NAMES.map((name, i) => (
              <button key={name} className={`lv${i <= t.status ? ' on' : ''}`} data-lv={i} style={{ ['--lc' as string]: `var(--st${i})` }} aria-label={`Level ${i + 1}: ${name}`} aria-pressed={i === t.status} title={name} />
            ))}
          </div>
          <span className="lv-label" title={STATUS_NAMES[t.status]}><Icon name={`s${t.status}`} /><span className="sr-only">{STATUS_NAMES[t.status]}</span></span>
          {t.status !== 4 && (
            <button className={`timer-btn${timerOn ? ' on' : ''}`} data-act="timer" aria-label={`${timerOn ? 'Pause' : 'Start'} focus timer`}>
              <Icon name={timerOn ? 'i-pause' : 'i-play'} />
              <span className="tt">{timerOn && timer ? <TimerText startedAt={timer.startedAt} /> : t.timeSpent >= 60 ? fmtDuration(t.timeSpent) : 'Focus'}</span>
            </button>
          )}
        </div>
      </article>
    </div>
  );
}
