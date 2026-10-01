'use client';
import { useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { isMine } from '@/lib/client/store';
import { askBlockedReason } from '@/lib/client/bus';
import { EMPTY, SHORT, todayISO } from '@/lib/client/util';
import type { ExportOptions } from '@/lib/client/export';
import { STATUS_NAMES, type Status, type Task } from '@/lib/types';
import { useDayflow, useStore, useUI } from './ctx';
import { Icon } from './Icons';
import { TaskCard } from './TaskCard';

function useFiltered(): Task[] {
  const s = useDayflow();
  const ui = useUI();
  // A personal space has one lane: everything is yours.
  const scope = s.org.kind === 'personal' ? 'all' : ui.boardTeam;
  return useMemo(() => {
    const q = ui.search.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/) : [];
    const today = todayISO();
    const name = (id: string | null) => (id ? s.members.find((m) => m.id === id)?.name.toLowerCase() || '' : '');
    const c = ui.chip;
    return s.tasks.filter((t) => {
      if (scope === 'personal' ? !t.private : scope === 'none' ? t.teamId || t.private : scope !== 'all' && t.teamId !== scope) return false;
      if (c === 'high' && t.priority !== 'high') return false;
      if (c === 'overdue' && !(t.dueDate && t.dueDate < today && t.status !== 4)) return false;
      if (c === 'today' && t.dueDate !== today) return false;
      if (c === 'mine' && !isMine(t, s.me.id)) return false;
      if (c.startsWith('tag:') && !t.tags.includes(c.slice(4))) return false;
      if (c.startsWith('person:') && t.assigneeId !== c.slice(7)) return false;
      return tokens.every((tok) => {
        if (tok.startsWith('#')) return t.tags.some((x) => x.startsWith(tok.slice(1)));
        if (tok.startsWith('@')) return name(t.assigneeId).startsWith(tok.slice(1));
        return [t.title, t.description, t.remarks, t.project, t.blockedReason, name(t.assigneeId), t.tags.join(' ')].join(' ').toLowerCase().includes(tok);
      });
    });
  }, [s.tasks, s.members, s.me.id, ui.search, ui.chip, scope]);
}

/** Opens the export dialog with the same filter the board is showing. */
function exportPreset(chip: string, search: string, boardTeam: string): Partial<ExportOptions> {
  const p: Partial<ExportOptions> = { scope: 'team', query: search, statuses: [0, 1, 2, 3, 4], priorities: ['high', 'medium', 'low'], due: 'any', assignees: [], projects: [], tags: [], teams: boardTeam === 'all' ? [] : [boardTeam] };
  if (chip === 'mine') p.scope = 'mine';
  else if (chip === 'high') p.priorities = ['high'];
  else if (chip === 'today') p.due = 'today';
  else if (chip === 'overdue') p.due = 'overdue';
  else if (chip.startsWith('tag:')) p.tags = [chip.slice(4)];
  else if (chip.startsWith('person:')) p.assignees = [chip.slice(7)];
  return p;
}

function Toolbar() {
  const s = useDayflow();
  const ui = useUI();
  const today = todayISO();
  const overdue = s.tasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== 4).length;
  const tags = [...new Set(s.tasks.flatMap((t) => t.tags))].slice(0, 6);
  const people = s.members.filter((m) => m.id !== s.me.id && s.tasks.some((t) => t.assigneeId === m.id)).slice(0, 6);
  const chips: Array<[string, React.ReactNode]> = [
    ['all', 'All'],
    ['mine', 'Mine'],
    ['high', '▲ High priority'],
    ['today', 'Due today'],
    ['overdue', <>Overdue{overdue ? <span className="n">{overdue}</span> : null}</>],
    ...tags.map((t): [string, React.ReactNode] => [`tag:${t}`, `#${t}`]),
    ...people.map((p): [string, React.ReactNode] => [`person:${p.id}`, `@${p.name.split(' ')[0]}`])
  ];
  const active = chips.some(([k]) => k === ui.chip) ? ui.chip : 'all';
  return (
    <section className="toolbar" aria-label="Filters">
      <div className="search glass">
        <Icon name="i-search" />
        <label htmlFor="search" className="sr-only">Search tasks</label>
        <input id="search" type="search" placeholder="Search tasks, #tags, @people  ( / )" value={ui.search} onChange={(e) => ui.setSearch(e.target.value)} />
      </div>
      <div className="chips" role="group" aria-label="Quick filters">
        {chips.map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={active === k} onClick={() => ui.setChip(active === k ? 'all' : k)}>{label}</button>
        ))}
      </div>
      <button className="btn btn-ghost toolbar-export" title="Export to Excel, PDF or CSV (E)" onClick={() => ui.openExport(exportPreset(active, ui.search, ui.boardTeam))}>
        <Icon name="i-download" /><span>Export</span>
      </button>
    </section>
  );
}

/** Team switcher: the whole organization, your private tasks, one team, or tasks without a team. */
function TeamScope() {
  const s = useDayflow();
  const ui = useUI();
  const count = (test: (t: Task) => boolean) => s.tasks.filter((t) => t.status !== 4 && test(t)).length;
  if (s.org.kind === 'personal') {
    return (
      <nav className="scope-bar" aria-label="Space">
        <span className="scope-solo"><Icon name="i-lock" />Just you · {count(() => true)} open · everything here is private</span>
        <button className="scope-pill scope-cta" onClick={ui.openTeamUp}><Icon name="i-users" />Create a team</button>
      </nav>
    );
  }
  const privateN = count((t) => t.private);
  if (!s.teams.length && !privateN) return null;
  const mine = new Set(s.me.teams.map((m) => m.teamId));
  // Your teams first, then the rest.
  const teams = [...s.teams].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.name.localeCompare(b.name));
  const loose = count((t) => !t.teamId && !t.private);
  const pill = (key: string, label: React.ReactNode, n: number, color?: string) => (
    <button key={key} className="scope-pill" aria-pressed={ui.boardTeam === key} style={color ? { ['--tc' as string]: color } : undefined} onClick={() => ui.setBoardTeam(key)}>
      {label}<span className="n">{n}</span>
    </button>
  );
  return (
    <nav className="scope-bar" aria-label="Team">
      <span className="scope-label">Team</span>
      {pill('all', 'All teams', count(() => true))}
      {pill('personal', <><Icon name="i-lock" className="scope-lock" />Personal</>, privateN)}
      {teams.map((t) => pill(t.id, <><i className="team-dot" style={{ background: t.color }} aria-hidden="true" />{t.name}</>, count((x) => x.teamId === t.id), t.color))}
      {(loose > 0 || ui.boardTeam === 'none') && pill('none', 'No team', loose)}
    </nav>
  );
}

function ColTabs({ list }: { list: Task[] }) {
  const ui = useUI();
  return (
    <nav className="col-tabs" role="tablist" aria-label="Status columns">
      {STATUS_NAMES.map((name, i) => {
        const n = list.filter((t) => t.status === i).length;
        const bump = ui.bumped.status === i ? ` bump bump-${ui.bumped.n % 2 ? 'b' : 'a'}` : '';
        return (
          <button key={name} className={`ctab${bump}`} role="tab" aria-selected={ui.mobileCol === i} style={{ ['--sc' as string]: `var(--st${i})` }} aria-label={`${name}, ${n} tasks`} onClick={() => ui.selectCol(i)}>
            <Icon name={`s${i}`} /><span className="lbl">{SHORT[i]}</span><span className="n">{n}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function BoardView() {
  const s = useDayflow();
  const store = useStore();
  const ui = useUI();
  const list = useFiltered();
  const boardRef = useRef<HTMLElement>(null);
  const rects = useRef(new Map<string, { x: number; y: number; w: number }>());
  const mounted = useRef(false);
  const dragId = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ status: number; before: string | null } | null>(null);
  const [colDir, setColDir] = useState({ from: '10deg', fx: '20px' });
  const lastCol = useRef(ui.mobileCol);
  const filtering = ui.chip !== 'all' || ui.search.trim() !== '' || ui.boardTeam !== 'all';
  const teamById = useMemo(() => new Map(s.teams.map((t) => [t.id, t])), [s.teams]);

  if (lastCol.current !== ui.mobileCol) {
    const fwd = ui.mobileCol > lastCol.current;
    lastCol.current = ui.mobileCol;
    setColDir({ from: fwd ? '12deg' : '-12deg', fx: fwd ? '24px' : '-24px' });
  }

  // FLIP: animate cards from where they were to where they are now.
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const origin = board.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number; w: number }>();
    board.querySelectorAll<HTMLElement>('.cw').forEach((w) => {
      const r = w.getBoundingClientRect();
      const rel = { x: r.left - origin.left + board.scrollLeft, y: r.top - origin.top, w: r.width };
      const id = w.dataset.id!;
      const prev = rects.current.get(id);
      if (prev && prev.w && rel.w && !ui.flat && (Math.abs(prev.x - rel.x) > 1 || Math.abs(prev.y - rel.y) > 1)) {
        w.animate([{ transform: `translate(${prev.x - rel.x}px, ${prev.y - rel.y}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      next.set(id, rel);
    });
    rects.current = next;
    mounted.current = true;
    const f = ui.takePendingFocus();
    if (f) board.querySelector<HTMLElement>(`.card[data-id="${f}"]`)?.focus({ preventScroll: true });
  });

  // ---- drag and drop between columns (desktop)
  const onDragStart = (e: DragEvent, id: string) => {
    dragId.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    const el = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => el.classList.add('dragging'));
  };
  const onDragEnd = () => {
    dragId.current = null;
    setDrop(null);
    boardRef.current?.querySelectorAll('.card.dragging').forEach((c) => c.classList.remove('dragging'));
  };
  const onDragOver = (e: DragEvent, status: number) => {
    if (!dragId.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const col = e.currentTarget as HTMLElement;
    const wraps = Array.from(col.querySelectorAll<HTMLElement>('.cw')).filter((w) => w.dataset.id !== dragId.current);
    const next = wraps.find((w) => { const r = w.getBoundingClientRect(); return r.top + r.height / 2 > e.clientY; });
    const before = next?.dataset.id ?? null;
    if (!drop || drop.status !== status || drop.before !== before) setDrop({ status, before });
  };
  const onDrop = async (e: DragEvent, status: Status) => {
    e.preventDefault();
    const id = dragId.current;
    const before = drop?.before ?? null;
    onDragEnd();
    const t = id ? store.get(id) : null;
    if (!t) return;
    if (status !== t.status && status === 2 && s.me.settings.requireBlockedReason) {
      const r = await askBlockedReason(t);
      if (r == null) return;
      store.updateTask(t.id, { blockedReason: r }, { undoable: false, label: 'Blocked reason' });
    }
    const rect = boardRef.current?.querySelector(`.card[data-id="${t.id}"]`)?.getBoundingClientRect() ?? null;
    const from = t.status;
    store.move(t.id, status, before);
    if (from !== status) ui.feedback(t, status, rect);
  };

  return (
    <>
      <TeamScope />
      <Toolbar />
      <ColTabs list={list} />
      <section
        ref={boardRef}
        className="board"
        id="board"
        aria-label="Task board"
        style={{ ['--from' as string]: colDir.from, ['--fx' as string]: colDir.fx }}
        onDragLeave={(e) => { if (!boardRef.current?.contains(e.relatedTarget as Node)) setDrop(null); }}
      >
        {STATUS_NAMES.map((name, i) => {
          const col = list.filter((t) => t.status === i).sort((a, b) => a.position - b.position);
          const isDrop = drop?.status === i;
          const line = <div key="drop-line" className="drop-line" />;
          return (
            <section
              key={name}
              className={`col glass${i === ui.mobileCol ? ' is-active' : ''}${isDrop ? ' drop-target' : ''}`}
              data-status={i}
              style={{ ['--c' as string]: `var(--st${i})` }}
              aria-label={`${name}, ${col.length} tasks`}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={(e) => onDrop(e, i as Status)}
            >
              <header className="col-head">
                <Icon name={`s${i}`} className="glyph" />
                <h2>{name}</h2>
                <span className="count">{col.length}</span>
                {i === 4 && col.length > 0 && <button className="link-btn" onClick={ui.clearDone}>Clear</button>}
              </header>
              <div className="col-body">
                {col.length === 0 && !isDrop && <p className="col-empty">{filtering ? 'No matches here.' : EMPTY[i]}</p>}
                {col.flatMap((t) => {
                  const card = (
                    <TaskCard
                      key={t.id}
                      t={t}
                      members={s.members}
                      timer={s.me.timer}
                      isNew={mounted.current && !rects.current.has(t.id) && Date.now() - t.createdAt < 5000}
                      draggable={!ui.phone}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      team={ui.boardTeam === 'all' && t.teamId ? teamById.get(t.teamId) : undefined}
                      showPrivate={s.org.kind === 'team' && ui.boardTeam !== 'personal'}
                    />
                  );
                  return isDrop && drop?.before === t.id ? [line, card] : [card];
                })}
                {isDrop && drop?.before === null && line}
              </div>
            </section>
          );
        })}
      </section>
      <p className="swipe-tip">Swipe a card → to move it up a level, ← to move it back.</p>
    </>
  );
}
