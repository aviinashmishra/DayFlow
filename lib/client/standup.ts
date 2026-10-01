import { STATUS_NAMES, type Settings, type Task } from '../types';
import { isMine, progress, type State } from './store';
import { ageLabel, daysSince, EMOJI, fmtDuration, startOfToday, todayISO } from './util';

/** Your personal standup: tasks assigned to you, or unassigned ones you created. */
export function standupText(s: State, fmt: Settings['standupFormat']): string {
  const { me } = s;
  const mine = s.tasks.filter((t) => isMine(t, me.id));
  const time = (t: Task) => (me.settings.shareFocusInStandup && t.timeSpent >= 60 ? ` (${fmtDuration(t.timeSpent)})` : '');
  const line = (t: Task) => {
    let x = `• ${t.title}${time(t)}`;
    if (t.status === 2) x += ` — ${t.blockedReason || 'reason not set'} (${ageLabel(daysSince(t.blockedAt))})`;
    if (t.status !== 4 && t.dueDate && t.dueDate < todayISO()) x += ' [overdue]';
    return x;
  };
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const b = fmt === 'slack' ? (x: string) => `*${x}*` : (x: string) => x;
  const today0 = startOfToday();
  const archivedMine = s.archived.filter((t) => isMine(t, me.id));
  const doneToday = mine.filter((t) => t.status === 4).concat(archivedMine.filter((t) => t.doneAt && t.doneAt >= today0));
  const by = (st: number) => mine.filter((t) => t.status === st).sort((a, c) => a.position - c.position);
  const out = [b(`Standup · ${me.name} · ${date}`), ''];

  if (fmt === 'ytb') {
    const since = today0 - 86400000;
    const done = mine.concat(archivedMine).filter((t) => t.status === 4 && t.doneAt && t.doneAt >= since);
    const today = by(1).concat(by(3), by(0).filter((t) => t.priority === 'high' || (t.dueDate && t.dueDate <= todayISO())));
    out.push('Yesterday / done', ...(done.length ? done.map(line) : ['• —']));
    out.push('', 'Today', ...(today.length ? today.map(line) : ['• Planning the day']));
    out.push('', 'Blockers', ...(by(2).length ? by(2).map(line) : ['• None']));
  } else {
    const groups: Array<[number, Task[]]> = [[4, doneToday], [3, by(3)], [1, by(1)], [2, by(2)], [0, by(0)]];
    for (const [st, list] of groups) {
      if (!list.length) continue;
      out.push(b(`${EMOJI[st]} ${STATUS_NAMES[st]} (${list.length})`), ...list.map(line), '');
    }
    if (out[out.length - 1] === '') out.pop();
  }
  out.push('', `Day progress: ${Math.round(progress(s) * 100)}%`);
  return out.join('\n');
}
