'use client';
import { useMemo, useState } from 'react';
import { toast } from '@/lib/client/bus';
import { focusSince, progress } from '@/lib/client/store';
import { ageLabel, copyText, daysSince, fmtDay, fmtDuration, startOfToday, todayISO } from '@/lib/client/util';
import { STATUS_NAMES, type Task } from '@/lib/types';
import { useDayflow, useStore, useUI } from './ctx';
import { Icon } from './Icons';
import { Avatar } from './TaskCard';

function Kpi({ icon, label, value, sub, warn }: { icon: string; label: string; value: string | number; sub: string; warn?: boolean }) {
  return (
    <div className="kpi glass">
      <div className="k-label"><Icon name={icon} />{label}</div>
      <div className="k-val">{value}</div>
      <div className={`k-sub${warn ? ' warn' : ''}`}>{sub}</div>
    </div>
  );
}

/**
 * Team pulse. `teamId` scopes it: 'all' (default), 'none' (tasks without a team) or a team id;
 * `label` names that scope in the report.
 */
export function Insights({ teamId = 'all', label, embedded = false }: { teamId?: string; label?: string; embedded?: boolean } = {}) {
  const s = useDayflow();
  const store = useStore();
  const ui = useUI();
  const [range, setRange] = useState(7);
  const [table, setTable] = useState(false);
  const DAY = 86400000;

  const d = useMemo(() => {
    // The organization pulse leaves out private tasks; in a personal space everything is yours.
    const inScope = (t: Task) => (s.org.kind === 'personal' || !t.private) && (teamId === 'all' || (teamId === 'none' ? !t.teamId : t.teamId === teamId));
    const tasks = s.tasks.filter(inScope);
    const from = startOfToday() - (range - 1) * DAY;
    const prevFrom = from - range * DAY;
    const all = tasks.concat(s.archived.filter(inScope));
    const done = all.filter((t) => t.status === 4 && t.doneAt && t.doneAt >= from);
    const donePrev = all.filter((t) => t.status === 4 && t.doneAt && t.doneAt >= prevFrom && t.doneAt < from).length;
    const blocked = tasks.filter((t) => t.status === 2).sort((a, b) => (a.blockedAt || 0) - (b.blockedAt || 0));
    const stale = blocked.filter((t) => daysSince(t.blockedAt) >= 2);
    const review = tasks.filter((t) => t.status === 3);
    const oldestReview = review.reduce((m, t) => Math.max(m, daysSince(t.statusChangedAt)), 0);
    const created = all.filter((t) => t.createdAt >= from);
    const voice = created.length ? Math.round((created.filter((t) => t.source === 'voice').length / created.length) * 100) : 0;

    const nameOf = (id: string | null) => (id ? s.members.find((m) => m.id === id)?.name ?? 'Former member' : 'Unassigned');
    const rowsMap = new Map<string, number[]>();
    tasks.forEach((t) => {
      const n = nameOf(t.assigneeId);
      if (!rowsMap.has(n)) rowsMap.set(n, [0, 0, 0, 0, 0]);
      rowsMap.get(n)![t.status]++;
    });
    const rows = [...rowsMap.entries()].map(([name, c]) => ({ name, c, total: c.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);

    const days = Array.from({ length: range }, (_, k) => {
      const i = range - 1 - k;
      const day = new Date(startOfToday() - i * DAY);
      const iso = todayISO(day);
      return { day, n: done.filter((t) => todayISO(new Date(t.doneAt!)) === iso).length };
    });
    const aging = tasks.filter((t) => t.status !== 4 && t.status !== 2 && daysSince(t.statusChangedAt) >= 3).sort((a, b) => a.statusChangedAt - b.statusChangedAt);
    const inProgress = tasks.filter((t) => t.status === 1).length;
    const queued = tasks.filter((t) => t.status === 0).length;
    return { from, done, delta: done.length - donePrev, blocked, stale, review, oldestReview, voice, created, rows, days, aging, nameOf, inProgress, queued };
  }, [s.tasks, s.archived, s.members, s.org.kind, range, DAY, teamId]);

  const focus = focusSince(s, d.from, store.timerElapsed());
  const max = Math.max(1, ...d.rows.map((r) => r.total));
  const dmax = Math.max(1, ...d.days.map((x) => x.n));
  const peak = d.days.reduce((a, b) => (b.n > a.n ? b : a), d.days[0]);

  const scopeName = label ?? s.org.name;
  const period = `${fmtDay(d.from, { day: 'numeric', month: 'short' })} – ${fmtDay(new Date(), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const report = useMemo(() => {
    const byPerson: Record<string, number> = {};
    d.done.forEach((t) => { const p = d.nameOf(t.assigneeId ?? t.creatorId); byPerson[p] = (byPerson[p] || 0) + 1; });
    const pri = { high: 0, medium: 1, low: 2 };
    const highlights = d.done.slice().sort((a, b) => pri[a.priority] - pri[b.priority] || (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 5);
    const doneVoice = d.done.length ? Math.round((d.done.filter((t) => t.source === 'voice').length / d.done.length) * 100) : 0;
    return [
      `${scopeName} · Dayflow report · ${period}`,
      '',
      `Completed: ${d.done.length} tasks (${d.delta >= 0 ? '+' : ''}${d.delta} vs previous period)`,
      `By person: ${Object.entries(byPerson).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(' · ') || '—'}`,
      '',
      'Highlights',
      ...(highlights.length ? highlights.map((t: Task) => `• ${t.title}${t.assigneeId ? ` (${d.nameOf(t.assigneeId)})` : ''}`) : ['• —']),
      '',
      `In flight: ${d.inProgress} in progress · ${d.review.length} in review · ${d.queued} queued`,
      `Blocked: ${d.blocked.length}${d.stale.length ? ` (${d.stale.length} older than 2 days)` : ''}`,
      ...d.blocked.map((t) => `• ${t.title} — ${t.blockedReason || 'no reason'} (${ageLabel(daysSince(t.blockedAt))})`),
      '',
      `Voice-captured: ${doneVoice}% of completed`
    ].join('\n');
  }, [d, scopeName, period]);

  const nudge = async (t: Task) => {
    const who = t.assigneeId && t.assigneeId !== s.me.id ? `Hi ${d.nameOf(t.assigneeId).split(' ')[0]}, ` : 'Hi team, ';
    const msg = `${who}“${t.title}” has been blocked for ${ageLabel(daysSince(t.blockedAt))}: ${t.blockedReason || 'no reason noted'}. What would unblock it? Anything I can do?`;
    toast((await copyText(msg)) ? 'Nudge copied — paste it in chat' : 'Could not copy', { icon: 'i-send' });
  };

  return (
    <section className={embedded ? 'insights-embedded' : 'view view-insights'} aria-label="Insights">
      <header className="ins-head">
        {embedded ? <span /> : (
          <div>
            <p className="eyebrow">{s.org.name} · team view</p>
            <h1 className="greet">Team pulse</h1>
          </div>
        )}
        <div className="seg" role="group" aria-label="Range">
          {[7, 30].map((r) => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r} days</button>)}
        </div>
      </header>

      <div className="kpis">
        <Kpi icon="s1" label="Your day" value={`${Math.round(progress(s) * 100)}%`} sub="weighted by status level" />
        <Kpi icon="s4" label={`Team done · ${range}d`} value={d.done.length} sub={`${d.delta >= 0 ? '↑' : '↓'} ${Math.abs(d.delta)} vs previous ${range}d`} />
        <Kpi icon="s2" label="Blocked now" value={d.blocked.length} sub={d.stale.length ? `⚠ ${d.stale.length} stale over 2 days` : 'none stale'} warn={d.stale.length > 0} />
        <Kpi icon="s3" label="In review" value={d.review.length} sub={d.review.length ? `oldest ${ageLabel(d.oldestReview)}` : 'queue clear'} />
        <Kpi icon="i-clock" label={`Your focus · ${range}d`} value={fmtDuration(focus)} sub={`≈ ${fmtDuration(Math.round(focus / range))} a day · private to you`} />
        <Kpi icon="i-mic" label="Added by voice" value={`${d.voice}%`} sub="target 25% or more" warn={d.voice < 25 && d.created.length > 3} />
      </div>

      <div className="ins-grid">
        <article className="panel glass p-load">
          <header className="panel-head">
            <div><h2>Workload by person</h2><p className="muted">Tasks on the board by status level</p></div>
            <button className="link-btn" aria-pressed={table} onClick={() => setTable(!table)}>{table ? 'Chart view' : 'Table view'}</button>
          </header>
          <div className="legend">{STATUS_NAMES.map((n, i) => <span key={n} style={{ ['--sc' as string]: `var(--st${i})` }}><i />{n}</span>)}</div>
          {table ? (
            <table className="data-table">
              <thead><tr><th>Person</th>{STATUS_NAMES.map((n) => <th key={n}>{n}</th>)}<th>Total</th></tr></thead>
              <tbody>{d.rows.map((r) => <tr key={r.name}><td>{r.name}</td>{r.c.map((v, i) => <td key={i}>{v}</td>)}<td><b>{r.total}</b></td></tr>)}</tbody>
            </table>
          ) : (
            <div className="hbars">
              {d.rows.length ? d.rows.map((r) => (
                <div key={r.name} className="hbar-row">
                  <div className="hbar-name">{r.name === 'Unassigned' ? <span className="avatar" style={{ ['--av' as string]: 'var(--st0)' }}>–</span> : <Avatar name={r.name} />}<span>{r.name}</span></div>
                  <div className="hbar-track">
                    {r.c.map((v, i) => v ? (
                      <div key={i} className="hbar-seg" tabIndex={0} style={{ ['--sc' as string]: `var(--st${i})`, width: `calc(${(v / max) * 100}% - 2px)` }} data-tip={`${r.name}|${STATUS_NAMES[i]}: ${v}`} aria-label={`${r.name}, ${STATUS_NAMES[i]}: ${v}`} />
                    ) : null)}
                  </div>
                  <div className="hbar-total">{r.total}</div>
                </div>
              )) : <p className="muted">No tasks yet.</p>}
            </div>
          )}
        </article>

        <article className="panel glass p-week cols-wrap">
          <header className="panel-head"><div><h2>Completed per day</h2><p className="muted">Last {range} days · {d.done.length} total</p></div></header>
          <div className="cols" style={{ ['--n' as string]: range, gap: range > 7 ? 2 : 6 }}>
            {d.days.map((x, i) => {
              const showV = range <= 7 ? x.n > 0 : x === peak && x.n > 0;
              const showD = range <= 7 || i % 5 === 0 || i === d.days.length - 1;
              const label = range <= 7 ? fmtDay(x.day, { weekday: 'short' }) : fmtDay(x.day, { day: 'numeric', month: 'short' });
              return (
                <div key={i} className={`col-bar${i === d.days.length - 1 ? ' today' : ''}`} tabIndex={0} data-tip={`${fmtDay(x.day)}|${x.n} completed`} aria-label={`${fmtDay(x.day)}: ${x.n} completed`}>
                  {showV && <span className="v">{x.n}</span>}
                  <div className="bar" style={{ height: `${(x.n / dmax) * 100}%`, width: range > 7 ? '100%' : undefined }} />
                  {showD && <span className="d">{label}</span>}
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel glass p-half">
          <header className="panel-head"><div><h2>Blocked right now</h2><p className="muted">Oldest first · stale after 2 days</p></div></header>
          <ul className="list">
            {d.blocked.length ? d.blocked.map((t) => {
              const age = daysSince(t.blockedAt);
              const st = age >= 2;
              return (
                <li key={t.id} className={st ? 'stale' : ''}>
                  <Icon name="s2" style={{ color: 'var(--st2)', marginTop: 3 }} />
                  <div className="li-main">
                    <button className="li-title" onClick={() => ui.openDetail(t.id)}>{t.title}</button>
                    <div className="li-sub">{t.blockedReason || 'No reason given'} · {d.nameOf(t.assigneeId)}</div>
                  </div>
                  <span className={`badge${st ? ' stale' : ''}`}>{ageLabel(age)}{st ? ' stale' : ''}</span>
                  <button className="icon-btn" aria-label={`Copy a nudge message for ${t.title}`} title="Copy nudge" onClick={() => nudge(t)}><Icon name="i-send" /></button>
                </li>
              );
            }) : <li className="empty">Nothing blocked right now.</li>}
          </ul>
        </article>

        <article className="panel glass p-half">
          <header className="panel-head"><div><h2>Aging tasks</h2><p className="muted">No status change in 3+ days</p></div></header>
          <ul className="list">
            {d.aging.length ? d.aging.map((t) => (
              <li key={t.id}>
                <Icon name={`s${t.status}`} style={{ color: `var(--st${t.status})`, marginTop: 3 }} />
                <div className="li-main">
                  <button className="li-title" onClick={() => ui.openDetail(t.id)}>{t.title}</button>
                  <div className="li-sub">{STATUS_NAMES[t.status]} · {d.nameOf(t.assigneeId)}</div>
                </div>
                <span className="badge">{ageLabel(daysSince(t.statusChangedAt))}</span>
              </li>
            )) : <li className="empty">Everything is moving.</li>}
          </ul>
        </article>

        <article className="panel glass p-full">
          <header className="panel-head">
            <div><h2>Weekly report</h2><p className="muted">Generated from the board. Copy it or send it by email.</p></div>
            <div className="row-gap">
              <a className="btn btn-ghost" href={`mailto:?subject=${encodeURIComponent(`Dayflow report · ${period}`)}&body=${encodeURIComponent(report)}`}><Icon name="i-mail" /><span>Email</span></a>
              <button className="btn btn-3d btn-primary" onClick={async () => toast((await copyText(report)) ? 'Report copied' : 'Could not copy', { icon: 'i-copy' })}><Icon name="i-copy" /><span>Copy</span></button>
            </div>
          </header>
          <pre className="report" id="reportText">{report}</pre>
        </article>
      </div>
    </section>
  );
}
