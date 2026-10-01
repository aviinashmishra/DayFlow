/*
 * Dayflow store: state, persistence (localStorage), activity history, undo,
 * focus timer bookkeeping. The shape follows the Phase 2 data model in the PRD
 * so moving to a server later is a transport change, not a rewrite.
 */
const Store = (() => {
  const KEY = 'dayflow.v1';
  const STATUS = ['Queued', 'In progress', 'Blocked', 'Review', 'Done'];
  const DAY = 86400000;

  const defaultSettings = {
    name: 'Avinash',
    team: ['Priya', 'Rahul', 'Meera', 'Arjun'],
    lang: 'en-IN',
    theme: 'auto',
    effects3d: true,
    weightByPriority: true,
    requireBlockedReason: true,
    shareFocusInStandup: false,
    pomodoro: 25,
    standupFormat: 'status',
    haptics: true
  };

  let state = load();
  const listeners = new Set();
  let undoStack = [];
  let saveTimer = null;

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function todayISO(d = new Date()) { return DayflowParser.iso(d); }

  function blank() {
    return { version: 1, tasks: [], archive: [], settings: { ...defaultSettings }, timer: null, focusLog: {}, lastOpen: null, seeded: false };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const s = JSON.parse(raw);
      return { ...blank(), ...s, settings: { ...defaultSettings, ...(s.settings || {}) } };
    } catch (e) {
      return blank();
    }
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked: keep working in memory */ }
    }, 60);
  }

  function emit(reason, detail) {
    persist();
    listeners.forEach((fn) => fn(reason, detail));
  }

  function snapshot(label) {
    undoStack.push({ label, data: JSON.stringify({ tasks: state.tasks, archive: state.archive, timer: state.timer }) });
    if (undoStack.length > 30) undoStack.shift();
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) return null;
    const d = JSON.parse(last.data);
    state.tasks = d.tasks; state.archive = d.archive; state.timer = d.timer;
    emit('undo');
    return last.label;
  }

  function log(task, text) {
    task.activity = task.activity || [];
    task.activity.unshift({ at: Date.now(), text });
    if (task.activity.length > 60) task.activity.length = 60;
  }

  function get(id) { return state.tasks.find((t) => t.id === id); }

  function nextOrder(status) {
    const col = state.tasks.filter((t) => t.status === status);
    return col.length ? Math.min(...col.map((t) => t.order)) - 1 : 0;
  }

  function addTask(p, source = 'typed') {
    const now = Date.now();
    const status = p.status == null ? 0 : p.status;
    const task = {
      id: uid(),
      title: p.title.trim(),
      status,
      priority: p.priority || 'medium',
      assignee: p.assignee || null,
      creator: state.settings.name,
      due: p.due || null,
      tags: p.tags || [],
      project: p.project || null,
      blockedReason: p.blockedReason || null,
      blockedAt: status === 2 ? now : null,
      reviewer: null,
      timeSpent: 0,
      createdAt: now,
      updatedAt: now,
      statusAt: now,
      doneAt: status === 4 ? now : null,
      source,
      order: nextOrder(status),
      comments: [],
      activity: []
    };
    log(task, `Created ${source === 'voice' ? 'by voice' : 'by typing'} in ${STATUS[status]}`);
    state.tasks.push(task);
    return task;
  }

  function addMany(parsed, source) {
    snapshot(parsed.length > 1 ? `Add ${parsed.length} tasks` : 'Add task');
    const created = parsed.map((p) => addTask(p, source));
    emit('add', created);
    return created;
  }

  function update(id, changes, { silent = false, skipSnapshot = false } = {}) {
    const t = get(id);
    if (!t) return null;
    if (!skipSnapshot) snapshot('Edit task');
    const now = Date.now();
    Object.keys(changes).forEach((k) => {
      const v = changes[k];
      if (JSON.stringify(t[k]) === JSON.stringify(v)) return;
      const old = t[k];
      t[k] = v;
      if (k === 'status') {
        log(t, `Status: ${STATUS[old]} → ${STATUS[v]}`);
        t.statusAt = now;
        t.order = nextOrder(v) - 0.5;
        if (v === 2 && !t.blockedAt) t.blockedAt = now;
        if (v !== 2) { t.blockedAt = null; }
        if (v === 4) t.doneAt = now; else t.doneAt = null;
        if (v === 4 && state.timer && state.timer.taskId === id) stopTimer(false);
      } else if (k === 'priority') log(t, `Priority → ${cap(v)}`);
      else if (k === 'assignee') log(t, v ? `Assigned to ${v}` : 'Unassigned');
      else if (k === 'due') log(t, v ? `Due date → ${v}` : 'Due date removed');
      else if (k === 'blockedReason' && v) log(t, `Blocked reason: ${v}`);
      else if (k === 'title') log(t, `Renamed from “${old}”`);
      else if (k === 'reviewer' && v) log(t, `Reviewer: ${v}`);
      else if (k === 'tags') log(t, `Tags: ${(v || []).map((x) => '#' + x).join(' ') || 'none'}`);
    });
    t.updatedAt = now;
    if (!silent) emit('update', t);
    return t;
  }

  function setStatus(id, status, extra = {}) {
    return update(id, { status, ...extra });
  }

  function move(id, status, beforeId) {
    const t = get(id);
    if (!t) return;
    snapshot('Move task');
    if (t.status !== status) update(id, { status }, { silent: true, skipSnapshot: true });
    const col = state.tasks.filter((x) => x.status === status && x.id !== id).sort((a, b) => a.order - b.order);
    const idx = beforeId ? col.findIndex((x) => x.id === beforeId) : col.length;
    const before = col[idx - 1];
    const after = col[idx];
    if (!before && !after) t.order = 0;
    else if (!before) t.order = after.order - 1;
    else if (!after) t.order = before.order + 1;
    else t.order = (before.order + after.order) / 2;
    emit('update', t);
  }

  function remove(id) {
    const t = get(id);
    if (!t) return;
    snapshot(`Delete “${t.title}”`);
    if (state.timer && state.timer.taskId === id) state.timer = null;
    state.tasks = state.tasks.filter((x) => x.id !== id);
    emit('remove', t);
  }

  function duplicate(id) {
    const t = get(id);
    if (!t) return;
    snapshot('Duplicate task');
    const c = addTask({ ...t, title: t.title + ' (copy)', status: 0, blockedReason: null }, t.source);
    emit('add', [c]);
  }

  // Cleared tasks go to the archive so weekly reports and streaks keep them.
  function clearDone() {
    const done = state.tasks.filter((t) => t.status === 4);
    if (!done.length) return 0;
    snapshot(`Clear ${done.length} done`);
    state.archive.push(...done.map((t) => ({ ...t, archived: true, activity: [], comments: t.comments })));
    state.tasks = state.tasks.filter((t) => t.status !== 4);
    emit('clear');
    return done.length;
  }

  function addComment(id, text) {
    const t = get(id);
    if (!t || !text.trim()) return;
    t.comments.push({ id: uid(), author: state.settings.name, text: text.trim(), at: Date.now() });
    log(t, 'Comment added');
    t.updatedAt = Date.now();
    emit('update', t);
  }

  // ---------- focus timer: one at a time ----------
  function timerElapsed() {
    return state.timer ? Math.floor((Date.now() - state.timer.startedAt) / 1000) : 0;
  }

  function stopTimer(emitChange = true) {
    if (!state.timer) return;
    const t = get(state.timer.taskId);
    const secs = timerElapsed();
    if (t && secs > 0) {
      t.timeSpent += secs;
      if (secs >= 60) log(t, `Focused ${fmtDuration(secs)}`);
    }
    const day = todayISO();
    state.focusLog[day] = (state.focusLog[day] || 0) + secs;
    state.timer = null;
    if (emitChange) emit('timer');
  }

  function startTimer(id) {
    const t = get(id);
    if (!t) return;
    if (state.timer && state.timer.taskId === id) return;
    if (state.timer) stopTimer(false);
    if (t.status !== 1) update(id, { status: 1 }, { silent: true });
    state.timer = { taskId: id, startedAt: Date.now(), notified: false };
    emit('timer');
  }

  function toggleTimer(id) {
    if (state.timer && state.timer.taskId === id) stopTimer();
    else startTimer(id);
  }

  function setSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    emit('settings');
  }

  // ---------- derived data ----------
  const STATUS_WEIGHT = [0, 0.4, 0.3, 0.8, 1];
  const PRI_WEIGHT = { high: 3, medium: 2, low: 1 };

  function todaysSet() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const archivedToday = state.archive.filter((t) => t.doneAt && t.doneAt >= start.getTime());
    return state.tasks.concat(archivedToday);
  }

  function progress() {
    const set = todaysSet();
    if (!set.length) return 0;
    let num = 0, den = 0;
    set.forEach((t) => {
      const w = state.settings.weightByPriority ? PRI_WEIGHT[t.priority] || 2 : 1;
      num += STATUS_WEIGHT[t.status] * w;
      den += w;
    });
    return den ? num / den : 0;
  }

  function allTasks() { return state.tasks.concat(state.archive); }

  function streak() {
    const days = new Set(allTasks().filter((t) => t.doneAt).map((t) => todayISO(new Date(t.doneAt))));
    let d = new Date(); let n = 0;
    if (!days.has(todayISO(d))) d = new Date(Date.now() - DAY);
    while (days.has(todayISO(d))) { n++; d = new Date(d.getTime() - DAY); }
    return n;
  }

  function focusToday() {
    return (state.focusLog[todayISO()] || 0) + timerElapsed();
  }

  function daysSince(ms) { return ms ? (Date.now() - ms) / DAY : 0; }

  function exportJSON() { return JSON.stringify(state, null, 2); }
  function importJSON(text) {
    const s = JSON.parse(text);
    if (!Array.isArray(s.tasks)) throw new Error('Not a Dayflow export');
    snapshot('Import');
    state = { ...blank(), ...s, settings: { ...defaultSettings, ...(s.settings || {}) } };
    emit('import');
  }
  function reset() {
    state = blank();
    state.seeded = true;
    undoStack = [];
    emit('import');
  }

  function removeSamples() {
    snapshot('Remove samples');
    state.tasks = state.tasks.filter((t) => !t.sample);
    state.archive = state.archive.filter((t) => !t.sample);
    emit('import');
  }

  // First run: sample tasks that show every feature, marked so they can be cleared.
  function seed() {
    if (state.seeded) return;
    const now = Date.now();
    const H = 3600000;
    const mk = (p, source, patch) => Object.assign(addTask(p, source), { sample: true }, patch);
    mk({ title: 'Fix checkout bug', status: 1, priority: 'high', tags: ['payments'] }, 'voice', { timeSpent: 1640 });
    mk({ title: 'API keys for payment gateway', status: 2, priority: 'high', blockedReason: 'Waiting on vendor to share sandbox keys', assignee: 'Rahul' }, 'typed', { blockedAt: now - 2.6 * DAY, statusAt: now - 2.6 * DAY, createdAt: now - 4 * DAY });
    mk({ title: 'Onboarding copy for new joiners', status: 3, priority: 'medium', assignee: 'Priya', tags: ['people'] }, 'voice', { reviewer: 'Avinash' });
    mk({ title: 'Plan sprint demo', status: 0, priority: 'low', due: DayflowParser.resolveDate('friday', new Date()) }, 'typed');
    mk({ title: 'Call vendor about invoice', status: 0, priority: 'medium', assignee: 'Meera', due: todayISO(new Date(now - DAY)) }, 'voice', { createdAt: now - 5 * DAY, statusAt: now - 5 * DAY });
    mk({ title: 'Update pricing page', status: 4, priority: 'medium', tags: ['web'] }, 'typed', { doneAt: now - 2 * H });
    const past = [
      ['Ship release notes', 1, 'Priya'], ['Customer call recap', 1, null], ['Refactor auth middleware', 2, 'Arjun'],
      ['Design review: dashboard', 2, 'Meera'], ['Hiring loop feedback', 3, null], ['Invoice reconciliation', 3, 'Rahul'],
      ['Weekly metrics email', 4, null], ['Bug bash triage', 5, 'Arjun'], ['Update team wiki', 5, 'Priya']
    ];
    past.forEach(([title, daysAgo, who], i) => {
      const at = now - daysAgo * DAY - i * H;
      state.archive.push({
        id: uid(), title, status: 4, priority: ['high', 'medium', 'low'][i % 3], assignee: who, creator: state.settings.name,
        due: null, tags: [], project: null, blockedReason: null, blockedAt: null, reviewer: null, timeSpent: 900 + i * 300,
        createdAt: at - DAY, updatedAt: at, statusAt: at, doneAt: at, source: i % 2 ? 'voice' : 'typed', order: 0,
        comments: [], activity: [], archived: true, sample: true
      });
    });
    get(state.tasks[0].id).comments.push({ id: uid(), author: 'Priya', text: 'Repro steps are in the support ticket.', at: now - 3 * H });
    for (let i = 1; i <= 5; i++) state.focusLog[todayISO(new Date(now - i * DAY))] = 1800 + i * 600;
    state.seeded = true;
    emit('seed');
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function fmtDuration(secs) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${secs}s`;
  }

  return {
    STATUS, STATUS_WEIGHT,
    get state() { return state; },
    get tasks() { return state.tasks; },
    get settings() { return state.settings; },
    subscribe: (fn) => listeners.add(fn),
    get, addMany, update, setStatus, move, remove, duplicate, clearDone, addComment,
    startTimer, stopTimer, toggleTimer, timerElapsed,
    setSettings, undo, canUndo: () => undoStack.length > 0,
    progress, streak, focusToday, allTasks, daysSince, todaysSet,
    exportJSON, importJSON, reset, removeSamples, seed, fmtDuration, todayISO,
    touchOpen() { const prev = state.lastOpen; state.lastOpen = todayISO(); persist(); return prev; },
    markTimerNotified() { if (state.timer) { state.timer.notified = true; persist(); } }
  };
})();
