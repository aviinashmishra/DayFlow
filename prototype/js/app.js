/*
 * Dayflow UI: rendering, capture (typed + voice), board interactions
 * (click levels, drag and drop, touch swipe, keyboard), focus timer,
 * standup, insights, sheets, toasts and small delights.
 */
(() => {
  'use strict';

  const P = DayflowParser;
  const S = Store;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const STATUS = S.STATUS;
  const SHORT = ['Queued', 'Doing', 'Blocked', 'Review', 'Done'];
  const EMOJI = ['📋', '🔨', '⛔', '👀', '✅'];
  const PRI_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
  const PRI_GLYPH = { high: '▲', medium: '◆', low: '▼' };
  const EMPTY = [
    'Nothing queued. Tap the mic and plan your day.',
    'Nothing in progress. Start a focus timer on a task.',
    'Nothing blocked. Nice.',
    'Nothing waiting for review.',
    'Finish something to see it here.'
  ];
  // Swipe / arrow-key flow skips Blocked: blocking is a deliberate act with a reason.
  const FLOW_NEXT = { 0: 1, 1: 3, 2: 1, 3: 4, 4: null };
  const FLOW_PREV = { 0: null, 1: 0, 2: 0, 3: 1, 4: 3 };
  const AVATAR_COLORS = ['#2a78d6', '#d9541f', '#128a5f', '#a86e00', '#c23d72', '#0b7a0b', '#5a49c4', '#c93a3a'];

  const mqPhone = matchMedia('(max-width: 760px)');
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mqDark = matchMedia('(prefers-color-scheme: dark)');

  const ui = { view: 'board', search: '', chip: 'all', mobileCol: 1, range: 7, loadTable: false, justAdded: new Set(), detailId: null };

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function clock(secs) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function fmtDay(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) { return d.toLocaleDateString('en-GB', opts); }
  function ageLabel(days) {
    if (days < 1 / 24) return 'just now';
    if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
    return `${Math.floor(days)}d`;
  }
  function relTime(ms) {
    const d = (Date.now() - ms) / 86400000;
    if (d < 1 / 1440) return 'just now';
    if (d < 1 / 24) return `${Math.round(d * 1440)} min ago`;
    if (d < 1) return `${Math.round(d * 24)} h ago`;
    if (d < 2) return 'yesterday';
    return `${Math.floor(d)} days ago`;
  }
  function dueInfo(t) {
    if (!t.due) return null;
    const diff = Math.round((parseISO(t.due) - startOfToday()) / 86400000);
    if (diff < 0) return { cls: 'overdue', label: `Overdue · ${fmtDay(parseISO(t.due), { day: 'numeric', month: 'short' })}`, diff };
    if (diff === 0) return { cls: 'today', label: 'Due today', diff };
    if (diff === 1) return { cls: '', label: 'Tomorrow', diff };
    if (diff < 7) return { cls: '', label: fmtDay(parseISO(t.due), { weekday: 'short' }), diff };
    return { cls: '', label: fmtDay(parseISO(t.due), { day: 'numeric', month: 'short' }), diff };
  }
  function initials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); }
  function avatarColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function avatar(name, cls = '') {
    return `<span class="avatar ${cls}" style="--av:${avatarColor(name)}" title="${esc(name)}" aria-label="Assigned to ${esc(name)}">${esc(initials(name))}</span>`;
  }
  function isMine(t) { return !t.assignee || t.assignee === S.settings.name; }
  function flat() { return mqReduce.matches || !S.settings.effects3d; }
  function haptic(pattern) { if (S.settings.haptics && navigator.vibrate) try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  function announce(msg) { const a = $('#announcer'); a.textContent = ''; setTimeout(() => { a.textContent = msg; }, 30); }
  function cardEl(id) { return $(`.card[data-id="${id}"]`); }
  function parserOpts() { return { team: [S.settings.name].concat(S.settings.team), now: new Date() }; }

  // ---------------------------------------------------------------- theme & effects
  function resolvedDark() {
    const th = S.settings.theme;
    return th === 'dark' || (th === 'auto' && mqDark.matches);
  }
  function applyTheme() {
    const th = S.settings.theme;
    if (th === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
    $('#themeBtn use').setAttribute('href', resolvedDark() ? '#i-sun' : '#i-moon');
    $('#themeBtn').setAttribute('aria-label', resolvedDark() ? 'Switch to light theme' : 'Switch to dark theme');
    $('meta[name="theme-color"]').setAttribute('content', resolvedDark() ? '#0a0e1f' : '#eef1f8');
    if (Orb.ready) Orb.setColors(statusColors());
  }
  function applyEffects() {
    document.documentElement.classList.toggle('flat', flat());
    if (Orb.ready) Orb.setReduced(flat());
  }
  function statusColors() {
    const cs = getComputedStyle(document.documentElement);
    return [0, 1, 2, 3, 4].map((i) => cs.getPropertyValue(`--st${i}`).trim() || '#888888');
  }

  // ---------------------------------------------------------------- filtering
  function filtered() {
    const q = ui.search.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/) : [];
    const today = S.todayISO();
    return S.tasks.filter((t) => {
      const c = ui.chip;
      if (c === 'high' && t.priority !== 'high') return false;
      if (c === 'overdue' && !(t.due && t.due < today && t.status !== 4)) return false;
      if (c === 'today' && t.due !== today) return false;
      if (c === 'mine' && !isMine(t)) return false;
      if (c.startsWith('tag:') && !t.tags.includes(c.slice(4))) return false;
      if (c.startsWith('person:') && t.assignee !== c.slice(7)) return false;
      return tokens.every((tok) => {
        if (tok.startsWith('#')) return t.tags.some((x) => x.startsWith(tok.slice(1)));
        if (tok.startsWith('@')) return (t.assignee || '').toLowerCase().startsWith(tok.slice(1));
        return [t.title, t.project, t.blockedReason, t.assignee, t.tags.join(' ')].join(' ').toLowerCase().includes(tok);
      });
    });
  }

  // ---------------------------------------------------------------- render: hero
  function renderHero() {
    const now = new Date();
    const h = now.getHours();
    const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const first = S.settings.name.split(' ')[0];
    $('#greet').innerHTML = `${part}, <span class="grad">${esc(first)}</span>`;
    const open = S.tasks.filter((t) => t.status !== 4).length;
    const dueToday = S.tasks.filter((t) => t.due === S.todayISO() && t.status !== 4).length;
    $('#dateLine').textContent = `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${open} open${dueToday ? ` · ${dueToday} due today` : ''}`;

    const p = S.progress();
    const pct = Math.round(p * 100);
    $('#pct').innerHTML = `${pct}<small>%</small>`;
    $('#orbCenter').setAttribute('aria-label', `Day progress ${pct} percent, weighted by status level`);
    $('#ringFill').style.strokeDashoffset = String(314.16 * (1 - p));
    const set = S.todaysSet();
    $('#statDone').textContent = `${set.filter((t) => t.status === 4).length}/${set.length}`;
    $('#statFocus').textContent = S.fmtDuration(S.focusToday());
    $('#statStreak').textContent = S.streak();
    if (Orb.ready) Orb.update(set, p, S.state.timer && S.state.timer.taskId);
  }

  // ---------------------------------------------------------------- render: chips
  function renderChips() {
    const today = S.todayISO();
    const overdue = S.tasks.filter((t) => t.due && t.due < today && t.status !== 4).length;
    const tags = [...new Set(S.tasks.flatMap((t) => t.tags))].slice(0, 6);
    const people = [...new Set(S.tasks.map((t) => t.assignee).filter((a) => a && a !== S.settings.name))].slice(0, 5);
    const chips = [
      ['all', 'All'],
      ['mine', 'Mine'],
      ['high', '▲ High priority'],
      ['today', 'Due today'],
      ['overdue', `Overdue${overdue ? ` <span class="n">${overdue}</span>` : ''}`]
    ].concat(tags.map((t) => [`tag:${t}`, `#${esc(t)}`]), people.map((p) => [`person:${p}`, `@${esc(p)}`]));
    if (!chips.some(([k]) => k === ui.chip)) ui.chip = 'all';
    $('#filterChips').innerHTML = chips.map(([k, label]) => `<button class="chip" data-chip="${esc(k)}" aria-pressed="${ui.chip === k}">${label}</button>`).join('');
  }

  // ---------------------------------------------------------------- render: board
  function ariaFor(t) {
    const bits = [t.title, STATUS[t.status], `${PRI_LABEL[t.priority]} priority`];
    const d = dueInfo(t);
    if (d) bits.push(d.label);
    if (t.assignee) bits.push(`assigned to ${t.assignee}`);
    if (t.status === 2 && t.blockedReason) bits.push(`blocked: ${t.blockedReason}`);
    return bits.join('. ');
  }

  function cardHTML(t) {
    const timer = S.state.timer;
    const timerOn = !!(timer && timer.taskId === t.id);
    const blockedAge = t.status === 2 ? S.daysSince(t.blockedAt) : 0;
    const stale = blockedAge >= 2;
    const due = t.status !== 4 ? dueInfo(t) : null;
    const meta = [];
    if (t.assignee) meta.push(avatar(t.assignee));
    if (due) meta.push(`<span class="due ${due.cls}"><svg><use href="#i-cal"/></svg>${esc(due.label)}</span>`);
    t.tags.forEach((tag) => meta.push(`<span class="tagc">#${esc(tag)}</span>`));
    if (t.project) meta.push(`<span class="mini">${esc(t.project)}</span>`);
    if (t.comments.length) meta.push(`<span class="mini" title="Comments"><svg><use href="#i-comment"/></svg>${t.comments.length}</span>`);

    const levels = STATUS.map((name, i) =>
      `<button class="lv${i <= t.status ? ' on' : ''}" data-lv="${i}" style="--lc:var(--st${i})" aria-label="Level ${i + 1}: ${name}" aria-pressed="${i === t.status}" title="${name}"></button>`
    ).join('');

    const timerBtn = t.status === 4 ? '' :
      `<button class="timer-btn${timerOn ? ' on' : ''}" data-act="timer" aria-label="${timerOn ? 'Pause' : 'Start'} focus timer"><svg><use href="#i-${timerOn ? 'pause' : 'play'}"/></svg><span class="tt">${timerOn ? clock(S.timerElapsed()) : t.timeSpent >= 60 ? S.fmtDuration(t.timeSpent) : 'Focus'}</span></button>`;

    const blocker = t.status !== 2 ? '' :
      `<div class="blocker${stale ? ' stale' : ''}"><svg><use href="#s2"/></svg><div>${t.blockedReason ? `<b>${esc(t.blockedReason)}</b>` : '<button class="link-btn" data-act="reason">Add blocked reason</button>'} · ${ageLabel(blockedAge)}${stale ? ' · stale' : ''}</div></div>`;

    const cls = ['card', `s-${t.status}`, `pri-${t.priority}`];
    if (timerOn) cls.push('focused-timer');
    if (ui.justAdded.has(t.id)) cls.push('enter');

    return `<div class="cw" data-id="${t.id}"><div class="swipe-hint" aria-hidden="true"></div>` +
      `<article class="${cls.join(' ')}" data-id="${t.id}" tabindex="0"${mqPhone.matches ? '' : ' draggable="true"'} style="--sc:var(--st${t.status})" aria-label="${esc(ariaFor(t))}">` +
      `<div class="card-top"><span class="pri"><i aria-hidden="true">${PRI_GLYPH[t.priority]}</i>${PRI_LABEL[t.priority]}</span>` +
      (t.source === 'voice' ? '<span class="src" title="Added by voice"><svg><use href="#i-mic"/></svg></span>' : '') +
      `<button class="icon-btn" data-act="open" aria-label="Open details"><svg><use href="#i-more"/></svg></button></div>` +
      `<h3 class="card-title">${esc(t.title)}</h3>${blocker}<div class="meta">${meta.join('')}</div>` +
      `<div class="levels-wrap"><div class="levels" role="group" aria-label="Status level">${levels}</div>` +
      `<span class="lv-label" title="${STATUS[t.status]}"><svg><use href="#s${t.status}"/></svg><span class="sr-only">${STATUS[t.status]}</span></span>${timerBtn}</div>` +
      `</article></div>`;
  }

  function flipFirst() {
    const m = new Map();
    if (flat()) return m;
    $$('#board .cw').forEach((w) => m.set(w.dataset.id, w.getBoundingClientRect()));
    return m;
  }
  function flipPlay(first) {
    if (!first.size) return;
    $$('#board .cw').forEach((w) => {
      const a = first.get(w.dataset.id);
      if (!a) return;
      const b = w.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      if (!b.width) return;
      w.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.closest || !a.closest('#board')) return null;
    const card = a.closest('.card');
    if (!card) return null;
    return { id: card.dataset.id, lv: a.dataset.lv, act: a.dataset.act };
  }
  function restoreFocus(f) {
    if (!f) return;
    const card = cardEl(f.id);
    if (!card) return;
    const target = (f.lv && card.querySelector(`[data-lv="${f.lv}"]`)) || (f.act && card.querySelector(`[data-act="${f.act}"]`)) || card;
    target.focus({ preventScroll: true });
  }

  function renderBoard() {
    const board = $('#board');
    const first = flipFirst();
    const focus = captureFocus();
    const list = filtered();
    const filtering = ui.chip !== 'all' || ui.search.trim();
    board.innerHTML = STATUS.map((name, i) => {
      const col = list.filter((t) => t.status === i).sort((a, b) => a.order - b.order);
      const clear = i === 4 && col.length ? '<button class="link-btn" data-act="clear">Clear</button>' : '';
      const body = col.length ? col.map(cardHTML).join('') : `<p class="col-empty">${filtering ? 'No matches here.' : EMPTY[i]}</p>`;
      return `<section class="col glass${i === ui.mobileCol ? ' is-active' : ''}" data-status="${i}" style="--c:var(--st${i})" aria-label="${name}, ${col.length} tasks">` +
        `<header class="col-head"><svg class="glyph"><use href="#s${i}"/></svg><h2>${name}</h2><span class="count">${col.length}</span>${clear}</header>` +
        `<div class="col-body">${body}</div></section>`;
    }).join('');
    ui.justAdded.clear();
    flipPlay(first);
    restoreFocus(focus);
  }

  function renderTabs() {
    const list = filtered();
    $('#colTabs').innerHTML = STATUS.map((name, i) => {
      const n = list.filter((t) => t.status === i).length;
      return `<button class="ctab" role="tab" data-col="${i}" aria-selected="${i === ui.mobileCol}" style="--sc:var(--st${i})" aria-label="${name}, ${n} tasks"><svg><use href="#s${i}"/></svg><span class="lbl">${SHORT[i]}</span><span class="n">${n}</span></button>`;
    }).join('');
  }
  function bumpTab(i) {
    const tab = $(`.ctab[data-col="${i}"]`);
    if (!tab) return;
    tab.classList.remove('bump'); void tab.offsetWidth; tab.classList.add('bump');
  }
  function selectCol(i) {
    const from = ui.mobileCol;
    ui.mobileCol = i;
    const board = $('#board');
    board.style.setProperty('--from', i > from ? '12deg' : '-12deg');
    board.style.setProperty('--fx', i > from ? '24px' : '-24px');
    $$('.col', board).forEach((c) => c.classList.toggle('is-active', +c.dataset.status === i));
    $$('.ctab').forEach((t) => t.setAttribute('aria-selected', String(+t.dataset.col === i)));
  }

  // ---------------------------------------------------------------- render: focus dock
  function renderDock() {
    const timer = S.state.timer;
    const dock = $('#focusDock');
    if (!timer || !S.get(timer.taskId)) { dock.hidden = true; document.title = 'Dayflow'; return; }
    dock.hidden = false;
    $('#dockTitle').textContent = S.get(timer.taskId).title;
    tick();
  }

  let chimed = false;
  function tick() {
    const timer = S.state.timer;
    if (!timer) return;
    const t = S.get(timer.taskId);
    if (!t) return;
    const secs = S.timerElapsed();
    $('#dockTime').textContent = clock(secs);
    const pomo = S.settings.pomodoro * 60;
    const frac = pomo ? Math.min(1, secs / pomo) : (secs % 3600) / 3600;
    $('#dockRing').style.strokeDashoffset = String(106.8 * (1 - frac));
    const btn = $(`.card[data-id="${t.id}"] .timer-btn .tt`);
    if (btn) btn.textContent = clock(secs);
    document.title = `▶ ${clock(secs)} · ${t.title} — Dayflow`;
    if (pomo && secs >= pomo && !timer.notified && !chimed) {
      chimed = true;
      S.markTimerNotified();
      chime();
      haptic([30, 80, 30]);
      toast(`${S.settings.pomodoro} minutes of focus on “${t.title}”. Take a short break?`, { icon: 'i-bolt', actions: [{ label: 'Pause', fn: () => S.stopTimer() }], timeout: 9000 });
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try { new Notification('Focus session complete', { body: t.title, icon: 'icons/icon.svg' }); } catch (e) { /* ignore */ }
      }
    }
  }
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.5);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.55);
      });
    } catch (e) { /* audio unavailable */ }
  }

  // ---------------------------------------------------------------- render all
  let queued = false;
  function scheduleRender() {
    if (queued) return;
    queued = true;
    const run = () => { if (!queued) return; queued = false; renderAll(); };
    requestAnimationFrame(run);
    setTimeout(run, 120); // rAF can stall (background tabs, throttled frames); never leave the board stale

  }
  function renderAll() {
    renderHero();
    renderChips();
    renderBoard();
    renderTabs();
    renderDock();
    if (ui.view === 'insights') renderInsights();
    if (ui.detailId && !$('#detailSheet').hidden && !isEditingIn($('#detailBody'))) renderDetail();
  }
  function isEditingIn(root) {
    const a = document.activeElement;
    return a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  }

  // ---------------------------------------------------------------- status changes
  async function changeStatus(id, status, opts = {}) {
    const t = S.get(id);
    if (!t || t.status === status) return false;
    const extra = {};
    if (status === 2) {
      if (opts.reason) extra.blockedReason = opts.reason;
      else if (S.settings.requireBlockedReason) {
        const r = await askBlockedReason(t);
        if (r == null) return false;
        extra.blockedReason = r;
      }
    }
    const el = opts.el || cardEl(id);
    const rect = el ? el.getBoundingClientRect() : null;
    S.setStatus(id, status, extra);
    feedback(t, status, rect, opts);
    return true;
  }

  function feedback(t, status, rect, opts = {}) {
    haptic(status === 4 ? [12, 40, 18] : 8);
    announce(`${t.title}: ${STATUS[status]}`);
    if (status === 4 && rect) confetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (mqPhone.matches) bumpTab(status);
    if (opts.toast) toast(`“${t.title}” → ${STATUS[status]}`, { undo: true, icon: `s${status}` });
    if (status === 4) {
      const set = S.todaysSet();
      if (set.length >= 3 && set.every((x) => x.status === 4)) {
        setTimeout(() => { confetti(innerWidth / 2, innerHeight / 3, 160); toast('Everything done today. Copy your standup?', { icon: 'i-sparkle', actions: [{ label: 'Copy', fn: copyStandup }] }); }, 400);
      }
    }
  }

  // ---------------------------------------------------------------- blocked reason modal
  function askBlockedReason(t) {
    return new Promise((resolve) => {
      const m = $('#blockedModal'), form = $('#blockedForm'), input = $('#blkReason');
      $('#blkTask').textContent = `“${t.title}” will appear on the team's blocked list with this note.`;
      input.value = t.blockedReason || '';
      const opener = document.activeElement;
      m.hidden = false;
      setTimeout(() => input.focus(), 30);
      const finish = (val) => {
        form.removeEventListener('submit', onSubmit);
        m.removeEventListener('click', onClick);
        m.removeEventListener('keydown', onKey, true);
        m.hidden = true;
        if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
        resolve(val);
      };
      const onSubmit = (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) { input.focus(); return; } finish(v); };
      const onClick = (e) => {
        const chip = e.target.closest('#blkChips .chip');
        if (chip) { input.value = chip.textContent; input.focus(); return; }
        if (e.target.closest('[data-cancel]') || e.target === m) finish(null);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
      form.addEventListener('submit', onSubmit);
      m.addEventListener('click', onClick);
      m.addEventListener('keydown', onKey, true);
    });
  }

  // ---------------------------------------------------------------- capture: typing
  const input = $('#captureInput');
  let previewTimer = null;

  function describe(p) {
    const chips = [];
    if (p.status !== null && p.status !== undefined) chips.push(`<span class="mini" style="--sc:var(--st${p.status})"><svg style="color:var(--sc)"><use href="#s${p.status}"/></svg>${STATUS[p.status]}</span>`);
    if (p.priority) chips.push(`<span class="mini">${PRI_GLYPH[p.priority]} ${PRI_LABEL[p.priority]}</span>`);
    if (p.due) chips.push(`<span class="mini"><svg><use href="#i-cal"/></svg>${esc(fmtDay(parseISO(p.due)))}</span>`);
    if (p.assignee) chips.push(`<span class="mini">@${esc(p.assignee)}</span>`);
    (p.tags || []).forEach((t) => chips.push(`<span class="tagc">#${esc(t)}</span>`));
    if (p.project) chips.push(`<span class="mini">${esc(p.project)}</span>`);
    if (p.blockedReason) chips.push(`<span class="mini">⛔ ${esc(p.blockedReason)}</span>`);
    return chips.join('');
  }

  function updatePreview() {
    const text = input.value.trim();
    const box = $('#parsePreview');
    if (!text) { box.innerHTML = ''; return; }
    if (/^(undo|scratch that|cancel that|oops)$/i.test(text)) { box.innerHTML = '<span class="pp-arrow">↺</span> Undo last change'; return; }
    const cmd = P.parseCommand(text, S.tasks, parserOpts());
    if (cmd) {
      const what = cmd.timer === 'pause' ? 'pause focus timer' : cmd.timer === 'start' ? 'start focus' : '';
      box.innerHTML = cmd.taskId
        ? `<span class="pp-arrow">↻ Update</span><span class="pp-title">“${esc(cmd.title)}”</span>${describe(cmd.changes)}${what ? `<span class="mini">${what}</span>` : ''}`
        : `<span class="pp-arrow">⏸</span> Pause focus timer`;
      return;
    }
    const parsed = P.parseInput(text, parserOpts());
    if (!parsed.length) { box.innerHTML = ''; return; }
    box.innerHTML = (parsed.length > 1 ? `<span class="mini"><b>${parsed.length} tasks</b></span>` : '') +
      parsed.map((p) => `<span class="pp-arrow">→</span><span class="pp-title">${esc(p.title)}</span>${describe(p)}`).join('');
  }

  input.addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 60); });

  $('#captureForm').addEventListener('submit', (e) => {
    e.preventDefault();
    commit(input.value, 'typed');
  });

  async function commit(raw, source) {
    const text = String(raw || '').trim();
    if (!text) { input.focus(); return; }
    if (/^(undo|scratch that|cancel that|oops)$/i.test(text)) { doUndo(); clearCapture(); return; }

    const cmd = P.parseCommand(text, S.tasks, parserOpts());
    if (cmd) { clearCapture(); await applyCommand(cmd); return; }

    const parsed = P.parseInput(text, parserOpts());
    if (!parsed.length) {
      $('#captureForm').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      return;
    }
    const created = S.addMany(parsed, source);
    created.forEach((t) => ui.justAdded.add(t.id));
    clearCapture();
    haptic(10);
    const n = created.length;
    announce(n > 1 ? `Added ${n} tasks` : `Added ${created[0].title}`);
    toast(n > 1 ? `Added ${n} tasks${source === 'voice' ? ' by voice' : ''}` : `Added “${created[0].title}”`, { undo: true, icon: source === 'voice' ? 'i-mic' : 'i-plus' });
    if (mqPhone.matches) selectCol(created[0].status);
    if (ui.view !== 'board') setView('board');
    if (created.some((t) => t.status === 4)) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = cardEl(created.find((t) => t.status === 4).id);
        if (el) { const r = el.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2); }
      }));
    }
  }

  async function applyCommand(cmd) {
    if (!cmd.taskId) {
      if (S.state.timer) { S.stopTimer(); toast('Focus timer paused', { icon: 'i-pause' }); }
      else toast('No timer is running', { icon: 'i-clock' });
      return;
    }
    const t = S.get(cmd.taskId);
    const changes = Object.assign({}, cmd.changes);
    if (changes.status === 2 && !changes.blockedReason && S.settings.requireBlockedReason) {
      const r = await askBlockedReason(t);
      if (r == null) return;
      changes.blockedReason = r;
    }
    const el = cardEl(t.id);
    const rect = el ? el.getBoundingClientRect() : null;
    const oldStatus = t.status;
    if (cmd.timer === 'pause') { S.stopTimer(); toast(`Paused “${t.title}”`, { icon: 'i-pause' }); return; }
    if (Object.keys(changes).length) S.update(t.id, changes);
    if (cmd.timer === 'start') S.startTimer(t.id);
    if (changes.status !== undefined && changes.status !== oldStatus) {
      feedback(t, changes.status, rect, {});
      if (mqPhone.matches) selectCol(changes.status);
    }
    const summary = Object.keys(changes).map((k) => k === 'status' ? STATUS[changes.status] : k === 'priority' ? `${PRI_LABEL[changes.priority]} priority` : k === 'due' ? `due ${fmtDay(parseISO(changes.due))}` : k === 'assignee' ? `@${changes.assignee}` : k === 'blockedReason' ? '' : k).filter(Boolean).join(', ');
    toast(`Updated “${t.title}”${summary ? ` → ${summary}` : ''}${cmd.timer === 'start' ? ' · focus started' : ''}`, { undo: true, icon: 'i-sparkle' });
  }

  function setPlaceholder() {
    input.placeholder = mqPhone.matches ? 'Type a task, or tap the mic…' : 'Type or speak a task… “Fix checkout bug, urgent, by Friday”';
  }

  function clearCapture() { input.value = ''; updatePreview(); }

  $('#tryRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-say]');
    if (!b) return;
    input.value = b.dataset.say;
    updatePreview();
    input.focus();
  });

  // ---------------------------------------------------------------- capture: voice
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, voiceError = false, silenceTimer = null, hardStop = null;
  const micButtons = [$('#micBtn'), $('#fabMic')];

  if (!SR) micButtons.forEach((b) => { b.classList.add('unsupported'); b.title = 'Voice needs Chrome, Edge or Safari. Typing always works.'; });

  function voiceStatus(html, isError) {
    const box = $('#voiceStatus');
    if (!html) { box.hidden = true; return; }
    box.hidden = false;
    box.classList.toggle('error', !!isError);
    box.innerHTML = html;
  }

  function setListening(on) {
    listening = on;
    micButtons.forEach((b) => { b.classList.toggle('listening', on); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Stop listening' : 'Add by voice'); });
  }

  function toggleVoice() { listening ? stopVoice() : startVoice(); }

  function startVoice() {
    if (!SR) {
      voiceStatus('Voice capture is not supported in this browser. Use Chrome, Edge or Safari, or just type — it understands the same words.', true);
      input.focus();
      return;
    }
    if (ui.view !== 'board') setView('board');
    if (mqPhone.matches) window.scrollTo({ top: 0, behavior: flat() ? 'auto' : 'smooth' });
    voiceError = false;
    rec = new SR();
    rec.lang = S.settings.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    input.value = '';
    updatePreview();

    rec.onstart = () => {
      setListening(true);
      haptic(15);
      voiceStatus('<span class="live">Listening…</span> Say “next task” between tasks. Tap the mic again when you are done.');
      hardStop = setTimeout(stopVoice, 90000);
    };
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + ' ';
      input.value = text.replace(/\s+/g, ' ').trim();
      updatePreview();
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(stopVoice, 2600);
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      voiceError = e.error !== 'no-speech';
      const msg = {
        'not-allowed': 'Microphone is blocked. Allow it from the lock icon in the address bar. Typing still works.',
        'service-not-allowed': 'Microphone is blocked for this page. Allow it in browser settings. Typing still works.',
        'no-speech': 'Didn’t catch anything. Tap the mic and try again.',
        'audio-capture': 'No microphone found. Plug one in or type instead.',
        network: 'The browser speech service is unreachable. Check your connection or type instead.',
        'language-not-supported': 'This speech language is not supported here. Change it in Settings.'
      }[e.error] || `Voice error: ${e.error}. Typing still works.`;
      voiceStatus(msg, true);
    };
    rec.onend = () => {
      clearTimeout(silenceTimer); clearTimeout(hardStop);
      setListening(false);
      const text = input.value.trim();
      if (!voiceError) voiceStatus('');
      if (text && !voiceError) commit(text, 'voice');
    };
    try { rec.start(); } catch (err) { voiceStatus('Could not start the microphone. Try again.', true); }
  }

  function stopVoice() {
    clearTimeout(silenceTimer);
    if (rec && listening) try { rec.stop(); } catch (e) { /* ignore */ }
  }

  micButtons.forEach((b) => b.addEventListener('click', toggleVoice));

  // ---------------------------------------------------------------- board events
  const board = $('#board');
  let swipe = null, suppressClick = false;

  board.addEventListener('click', async (e) => {
    if (suppressClick) return;
    if (e.target.closest('[data-act="clear"]')) { clearDone(); return; }
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const lv = e.target.closest('.lv');
    if (lv) { await changeStatus(id, +lv.dataset.lv, { el: card }); return; }
    const act = (e.target.closest('[data-act]') || {}).dataset;
    if (act && act.act === 'timer') { S.toggleTimer(id); haptic(8); return; }
    if (act && act.act === 'reason') { const r = await askBlockedReason(S.get(id)); if (r) S.update(id, { blockedReason: r }); return; }
    if (act && act.act === 'open') { openDetail(id); return; }
    if (!e.target.closest('button')) openDetail(id);
  });

  board.addEventListener('keydown', async (e) => {
    const card = e.target.closest('.card');
    if (!card || e.target !== card) return;
    const id = card.dataset.id;
    const t = S.get(id);
    if (!t) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      const to = k === 'ArrowRight' ? FLOW_NEXT[t.status] : FLOW_PREV[t.status];
      if (to !== null) await changeStatus(id, to, { el: card });
      if (mqPhone.matches && to !== null) selectCol(to);
      requestAnimationFrame(() => { const c = cardEl(id); if (c) c.focus(); });
    } else if (/^[1-5]$/.test(k)) {
      e.preventDefault();
      await changeStatus(id, +k - 1, { el: card });
      requestAnimationFrame(() => { const c = cardEl(id); if (c) c.focus(); });
    } else if (k === ' ') {
      e.preventDefault(); S.toggleTimer(id);
    } else if (k === 'Enter') {
      e.preventDefault(); openDetail(id);
    } else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault(); deleteTask(id);
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      const cards = $$('.card', card.closest('.col'));
      const i = cards.indexOf(card) + (k === 'ArrowDown' ? 1 : -1);
      if (cards[i]) cards[i].focus();
    }
  });

  // 3D tilt with a light glare that follows the pointer (mouse only).
  let tiltCard = null;
  function resetTilt(c) {
    if (!c) return;
    c.classList.remove('tilting');
    c.style.removeProperty('--rx'); c.style.removeProperty('--ry');
    if (tiltCard === c) tiltCard = null;
  }
  board.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || flat() || dragId) return;
    const card = e.target.closest('.card');
    if (tiltCard && tiltCard !== card) resetTilt(tiltCard);
    if (!card) return;
    tiltCard = card;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    card.classList.add('tilting');
    card.style.setProperty('--ry', `${((px - 0.5) * 12).toFixed(2)}deg`);
    card.style.setProperty('--rx', `${((0.5 - py) * 10).toFixed(2)}deg`);
    card.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
  });
  board.addEventListener('pointerleave', () => resetTilt(tiltCard));

  // Drag and drop between columns (desktop).
  let dragId = null, dropBefore = null, dropCol = null;
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    resetTilt(card);
    dragId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  board.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const col = e.target.closest('.col');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropCol !== col) { if (dropCol) dropCol.classList.remove('drop-target'); dropCol = col; col.classList.add('drop-target'); }
    const wraps = $$('.cw', col).filter((w) => w.dataset.id !== dragId);
    const next = wraps.find((w) => { const r = w.getBoundingClientRect(); return r.top + r.height / 2 > e.clientY; });
    const beforeId = next ? next.dataset.id : null;
    const line = $('.drop-line', board);
    if (beforeId === dropBefore && line && line.parentElement.closest('.col') === col) return;
    dropBefore = beforeId;
    if (line) line.remove();
    const l = document.createElement('div');
    l.className = 'drop-line';
    const body = $('.col-body', col);
    if (next) body.insertBefore(l, next); else body.appendChild(l);
  });
  board.addEventListener('dragleave', (e) => { if (!board.contains(e.relatedTarget)) clearDrop(); });
  board.addEventListener('drop', async (e) => {
    e.preventDefault();
    const col = e.target.closest('.col');
    const id = dragId, beforeId = dropBefore;
    clearDrop();
    dragId = null;
    if (!col || !id) return;
    const t = S.get(id);
    const status = +col.dataset.status;
    const oldStatus = t.status;
    if (status !== oldStatus && status === 2 && S.settings.requireBlockedReason) {
      const r = await askBlockedReason(t);
      if (r == null) { scheduleRender(); return; }
      S.update(id, { blockedReason: r }, { silent: true, skipSnapshot: true });
    }
    const el = cardEl(id);
    const rect = el ? el.getBoundingClientRect() : null;
    S.move(id, status, beforeId);
    if (status !== oldStatus) feedback(t, status, rect, {});
  });
  board.addEventListener('dragend', () => {
    dragId = null;
    clearDrop();
    $$('.card.dragging').forEach((c) => c.classList.remove('dragging'));
  });
  function clearDrop() {
    const l = $('.drop-line', board);
    if (l) l.remove();
    if (dropCol) dropCol.classList.remove('drop-target');
    dropCol = null; dropBefore = null;
  }

  // Touch swipe: right = next level, left = previous level (phone layout).
  board.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !mqPhone.matches) return;
    const card = e.target.closest('.card');
    if (!card) return;
    swipe = { card, wrap: card.parentElement, id: card.dataset.id, x: e.clientX, y: e.clientY, dx: 0, active: false, pid: e.pointerId, target: null };
  });
  board.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.pid) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
      if (Math.abs(dx) < 12) return;
      swipe.active = true;
      try { swipe.card.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      swipe.card.style.transition = 'none';
    }
    const t = S.get(swipe.id);
    if (!t) return;
    const target = dx > 0 ? FLOW_NEXT[t.status] : FLOW_PREV[t.status];
    const eff = target === null ? dx * 0.25 : dx;
    swipe.dx = eff;
    swipe.target = target;
    const hint = $('.swipe-hint', swipe.wrap);
    hint.className = `swipe-hint ${dx > 0 ? 'fwd' : 'back'}`;
    hint.textContent = target === null ? '' : dx > 0 ? `→ ${STATUS[target]}` : `${STATUS[target]} ←`;
    hint.style.background = target === null ? 'var(--surface-3)' : `var(--st${target})`;
    hint.style.opacity = String(Math.min(1, Math.abs(eff) / 90));
    swipe.card.style.transform = `perspective(700px) translateX(${eff}px) rotateY(${eff / 14}deg)`;
  });
  const endSwipe = async () => {
    if (!swipe) return;
    const s = swipe;
    swipe = null;
    if (!s.active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 60);
    const hint = $('.swipe-hint', s.wrap);
    const reset = () => {
      s.card.style.transition = '';
      s.card.style.transform = '';
      if (hint) hint.style.opacity = '0';
    };
    if (Math.abs(s.dx) > 85 && s.target !== null) {
      s.card.style.transition = 'transform .25s ease-in, opacity .25s';
      s.card.style.transform = `perspective(700px) translateX(${s.dx > 0 ? 120 : -120}%) rotateY(${s.dx > 0 ? 35 : -35}deg)`;
      s.card.style.opacity = '0';
      const ok = await changeStatus(s.id, s.target, { el: s.card, toast: true });
      if (!ok) { s.card.style.opacity = ''; reset(); }
    } else reset();
  };
  board.addEventListener('pointerup', endSwipe);
  board.addEventListener('pointercancel', endSwipe);

  $('#colTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.ctab');
    if (b) selectCol(+b.dataset.col);
  });

  $('#filterChips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-chip]');
    if (!c) return;
    ui.chip = ui.chip === c.dataset.chip ? 'all' : c.dataset.chip;
    renderChips(); renderBoard(); renderTabs();
  });
  $('#search').addEventListener('input', (e) => { ui.search = e.target.value; renderBoard(); renderTabs(); });

  function clearDone() {
    const n = S.clearDone();
    if (n) toast(`Cleared ${n} done ${n > 1 ? 'tasks' : 'task'}. They stay in reports.`, { undo: true, icon: 's4' });
  }
  function deleteTask(id) {
    const t = S.get(id);
    if (!t) return;
    S.remove(id);
    toast(`Deleted “${t.title}”`, { undo: true, icon: 'i-trash' });
  }
  function doUndo() {
    const label = S.undo();
    toast(label ? `Undone: ${label}` : 'Nothing to undo', { icon: 'i-undo' });
  }

  // ---------------------------------------------------------------- focus dock
  $('#dockPause').addEventListener('click', () => S.stopTimer());
  $('#dockDone').addEventListener('click', () => { const t = S.state.timer; if (t) changeStatus(t.taskId, 3, { toast: true }); });
  $('#dockTitle').addEventListener('click', () => { const t = S.state.timer; if (t) openDetail(t.taskId); });

  // ---------------------------------------------------------------- sheets & modals
  let lastFocus = null;
  function openSheet(el) {
    closeSheets(true);
    lastFocus = document.activeElement;
    $('#scrim').hidden = false;
    el.hidden = false;
    const f = el.querySelector('[data-close]');
    setTimeout(() => (el.querySelector('.sheet-body input, .sheet-body textarea, .sheet-body button') || f).focus({ preventScroll: true }), 50);
  }
  function closeSheets(silent) {
    const wasOpen = $$('.sheet').some((s) => !s.hidden);
    $$('.sheet').forEach((s) => { s.hidden = true; });
    $('#scrim').hidden = true;
    ui.detailId = null;
    if (!silent && wasOpen && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  $('#scrim').addEventListener('click', () => closeSheets());
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheets()));

  // Drag a sheet down by its handle to close it on phones.
  $$('.sheet').forEach((sheet) => {
    let y0 = null, dy = 0;
    const head = [$('.sheet-grab', sheet), $('.sheet-head', sheet)];
    head.forEach((h) => h.addEventListener('pointerdown', (e) => {
      if (!mqPhone.matches || e.target.closest('button')) return;
      y0 = e.clientY; dy = 0; sheet.style.transition = 'none';
      h.setPointerCapture(e.pointerId);
    }));
    head.forEach((h) => h.addEventListener('pointermove', (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.clientY - y0);
      sheet.style.transform = `translateY(${dy}px)`;
    }));
    const end = () => {
      if (y0 === null) return;
      y0 = null;
      sheet.style.transition = 'transform .25s';
      if (dy > 110) closeSheets();
      sheet.style.transform = '';
    };
    head.forEach((h) => { h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end); });
  });

  function openModal(m) {
    m.dataset.opener = '';
    m._opener = document.activeElement;
    m.hidden = false;
    const f = m.querySelector('.seg button[aria-pressed="true"], button.btn-primary, [data-cancel]');
    setTimeout(() => f && f.focus({ preventScroll: true }), 30);
  }
  function closeModal(m) {
    m.hidden = true;
    if (m._opener && document.contains(m._opener)) m._opener.focus({ preventScroll: true });
  }
  ['#standupModal', '#helpModal'].forEach((sel) => {
    const m = $(sel);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-cancel]')) closeModal(m); });
  });

  // ---------------------------------------------------------------- detail sheet
  function openDetail(id) {
    ui.detailId = id;
    renderDetail();
    openSheet($('#detailSheet'));
    ui.detailId = id;
  }

  function renderDetail() {
    const t = S.get(ui.detailId);
    if (!t) { closeSheets(); return; }
    const timerOn = !!(S.state.timer && S.state.timer.taskId === t.id);
    const people = [S.settings.name].concat(S.settings.team);
    $('#dTitleLabel').textContent = `${t.source === 'voice' ? 'Voice' : 'Typed'} task · ${STATUS[t.status]}`;
    $('#detailBody').innerHTML = `
      <div><label class="sr-only" for="dTitle">Title</label><textarea id="dTitle" class="field title-field" rows="2">${esc(t.title)}</textarea></div>
      <div><span class="field-label">Status level</span>
        <div class="seg status-seg" role="group" aria-label="Status">${STATUS.map((n, i) => `<button data-st="${i}" style="--sc:var(--st${i})" aria-pressed="${i === t.status}"><svg><use href="#s${i}"/></svg>${n}</button>`).join('')}</div>
      </div>
      ${t.status === 2 ? `<div><label class="field-label" for="dReason">Blocked reason</label><input id="dReason" class="field" maxlength="140" value="${esc(t.blockedReason || '')}" placeholder="What is needed to move forward?"><p class="muted" style="margin-top:6px">Blocked for ${ageLabel(S.daysSince(t.blockedAt))}. Visible on the team's blocked list.</p></div>` : ''}
      ${t.status === 3 ? `<div><label class="field-label" for="dReviewer">Reviewer</label><input id="dReviewer" class="field" list="teamList" value="${esc(t.reviewer || '')}" placeholder="Who checks it?"></div>` : ''}
      <div><span class="field-label">Priority</span>
        <div class="seg" role="group" aria-label="Priority">${['high', 'medium', 'low'].map((p) => `<button data-pri="${p}" aria-pressed="${t.priority === p}">${PRI_GLYPH[p]} ${PRI_LABEL[p]}</button>`).join('')}</div>
      </div>
      <div class="two">
        <div><label class="field-label" for="dAssignee">Assignee</label><input id="dAssignee" class="field" list="teamList" value="${esc(t.assignee || '')}" placeholder="Unassigned"></div>
        <div><label class="field-label" for="dDue">Due date</label><input id="dDue" type="date" class="field" value="${t.due || ''}"></div>
      </div>
      <div class="two">
        <div><label class="field-label" for="dTags">Tags</label><input id="dTags" class="field" value="${esc(t.tags.join(', '))}" placeholder="design, backend"></div>
        <div><label class="field-label" for="dProject">Project</label><input id="dProject" class="field" value="${esc(t.project || '')}" placeholder="None"></div>
      </div>
      <datalist id="teamList">${people.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="row-gap" style="flex-wrap:wrap;gap:14px">
        ${t.status !== 4 ? `<button class="btn btn-3d btn-primary" data-dact="timer"><svg><use href="#i-${timerOn ? 'pause' : 'play'}"/></svg>${timerOn ? 'Pause focus' : 'Start focus'}</button>` : ''}
        <div class="stat-line"><span>Focus <b>${S.fmtDuration(t.timeSpent + (timerOn ? S.timerElapsed() : 0))}</b></span><span>Added <b>${relTime(t.createdAt)}</b></span></div>
      </div>
      <section>
        <span class="field-label">Comments · ${t.comments.length}</span>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px">
          ${t.comments.map((c) => `<div class="comment">${avatar(c.author)}<div class="bubble"><small><b>${esc(c.author)}</b> · ${relTime(c.at)}</small>${esc(c.text)}</div></div>`).join('')}
        </div>
        <form class="comment-form" id="commentForm"><label class="sr-only" for="commentInput">Comment</label><input class="field" id="commentInput" placeholder="Add a comment…" autocomplete="off"><button class="btn btn-3d btn-primary" aria-label="Post comment"><svg><use href="#i-send"/></svg></button></form>
      </section>
      <section>
        <span class="field-label">Activity</span>
        <ul class="timeline">${t.activity.slice(0, 25).map((a) => `<li><div>${esc(a.text)}<time>${relTime(a.at)}</time></div></li>`).join('')}</ul>
      </section>`;
  }

  const detailBody = $('#detailBody');
  detailBody.addEventListener('click', async (e) => {
    const id = ui.detailId;
    if (!id) return;
    const st = e.target.closest('[data-st]');
    if (st) { await changeStatus(id, +st.dataset.st); renderDetail(); return; }
    const pri = e.target.closest('[data-pri]');
    if (pri) { S.update(id, { priority: pri.dataset.pri }); renderDetail(); return; }
    if (e.target.closest('[data-dact="timer"]')) { S.toggleTimer(id); renderDetail(); }
  });
  detailBody.addEventListener('change', (e) => {
    const id = ui.detailId;
    if (!id) return;
    const v = e.target.value.trim();
    const map = {
      dTitle: () => v && S.update(id, { title: v }),
      dAssignee: () => S.update(id, { assignee: v || null }),
      dDue: () => S.update(id, { due: v || null }),
      dTags: () => S.update(id, { tags: v.split(/[,\s]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter(Boolean) }),
      dProject: () => S.update(id, { project: v || null }),
      dReason: () => v && S.update(id, { blockedReason: v }),
      dReviewer: () => S.update(id, { reviewer: v || null })
    };
    if (map[e.target.id]) map[e.target.id]();
  });
  detailBody.addEventListener('keydown', (e) => {
    if (e.target.id === 'dTitle' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  detailBody.addEventListener('submit', (e) => {
    if (e.target.id !== 'commentForm') return;
    e.preventDefault();
    const inp = $('#commentInput');
    if (!inp.value.trim()) return;
    S.addComment(ui.detailId, inp.value);
    renderDetail();
    $('#commentInput').focus();
  });
  $('#dDelete').addEventListener('click', () => { const id = ui.detailId; closeSheets(); deleteTask(id); });
  $('#dDuplicate').addEventListener('click', () => { S.duplicate(ui.detailId); toast('Duplicated to Queued', { undo: true, icon: 'i-copy' }); });

  // ---------------------------------------------------------------- settings
  function renderSettings() {
    const s = S.settings;
    const sw = (key, title, sub) => `<div class="toggle-row"><div><b>${title}</b><span>${sub}</span></div><label class="switch"><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''} aria-label="${title}"><i></i></label></div>`;
    $('#settingsBody').innerHTML = `
      <div class="set-group"><h3>You and your team</h3>
        <label class="field-label" for="sName">Your name</label><input id="sName" class="field" value="${esc(s.name)}">
        <label class="field-label" for="sTeam" style="margin-top:12px">Team members</label><input id="sTeam" class="field" value="${esc(s.team.join(', '))}" placeholder="Priya, Rahul">
        <p class="muted" style="margin-top:6px">Used for “assign to …” in voice and the workload chart.</p>
      </div>
      <div class="set-group"><h3>Voice</h3>
        <label class="field-label" for="sLang">Speech language</label>
        <select id="sLang" class="field">
          ${[['en-IN', 'English (India) — works with Hinglish'], ['hi-IN', 'Hindi'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)']].map(([v, l]) => `<option value="${v}" ${s.lang === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <p class="muted" style="margin-top:6px">Audio is handled by your browser's speech service. Dayflow stores only the text, never recordings.</p>
      </div>
      <div class="set-group"><h3>Board</h3>
        ${sw('requireBlockedReason', 'Ask why when blocked', 'A short note goes to the team blocked list')}
        ${sw('weightByPriority', 'Weight progress by priority', 'High counts 3×, medium 2×, low 1×')}
        ${sw('shareFocusInStandup', 'Show focus time in standup', 'Off by default — the timer is for you')}
        <div class="toggle-row"><div><b>Focus session length</b><span>Chime and nudge for a break</span></div>
          <select id="sPomo" class="field" style="width:auto;min-height:38px">${[0, 15, 25, 45, 50].map((m) => `<option value="${m}" ${s.pomodoro === m ? 'selected' : ''}>${m ? m + ' min' : 'Off'}</option>`).join('')}</select>
        </div>
      </div>
      <div class="set-group"><h3>Look and feel</h3>
        <div class="seg" role="group" aria-label="Theme" id="sTheme">${['auto', 'dark', 'light'].map((v) => `<button data-theme-val="${v}" aria-pressed="${s.theme === v}">${cap(v)}</button>`).join('')}</div>
        ${sw('effects3d', '3D effects', 'Card tilt, animated orb and depth. Turns off automatically with reduced motion.')}
        ${sw('haptics', 'Haptic feedback', 'Small vibrations on phones')}
      </div>
      <div class="set-group"><h3>Data</h3>
        <p class="muted" style="margin-bottom:10px">Everything is stored in this browser. Export to back up or move devices.</p>
        <div class="row-gap" style="flex-wrap:wrap">
          <button class="btn btn-ghost" id="sExport">Export JSON</button>
          <label class="btn btn-ghost" for="sImport" style="cursor:pointer">Import JSON</label><input id="sImport" type="file" accept="application/json,.json" class="sr-only">
          <button class="btn btn-ghost" id="sSamples">Remove sample tasks</button>
          <button class="btn btn-ghost" id="sReset" style="color:var(--danger)">Reset everything</button>
        </div>
      </div>`;
  }

  const settingsBody = $('#settingsBody');
  settingsBody.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.set) { S.setSettings({ [t.dataset.set]: t.checked }); if (t.dataset.set === 'effects3d') applyEffects(); return; }
    if (t.id === 'sName' && t.value.trim()) S.setSettings({ name: t.value.trim() });
    if (t.id === 'sTeam') S.setSettings({ team: t.value.split(',').map((x) => x.trim()).filter(Boolean) });
    if (t.id === 'sLang') S.setSettings({ lang: t.value });
    if (t.id === 'sPomo') S.setSettings({ pomodoro: +t.value });
    if (t.id === 'sImport' && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try { S.importJSON(reader.result); applyTheme(); applyEffects(); toast('Imported', { icon: 'i-sparkle', undo: true }); renderSettings(); } catch (err) { toast(`Import failed: ${err.message}`, { icon: 'i-x' }); }
      };
      reader.readAsText(t.files[0]);
    }
  });
  settingsBody.addEventListener('click', (e) => {
    const th = e.target.closest('[data-theme-val]');
    if (th) { S.setSettings({ theme: th.dataset.themeVal }); applyTheme(); renderSettings(); return; }
    if (e.target.id === 'sExport') {
      const blob = new Blob([S.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dayflow-${S.todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (e.target.id === 'sSamples') { S.removeSamples(); toast('Sample tasks removed', { undo: true, icon: 'i-trash' }); }
    if (e.target.id === 'sReset' && confirm('Delete all tasks, history and settings in this browser?')) { S.reset(); applyTheme(); applyEffects(); renderSettings(); toast('Everything reset', { icon: 'i-trash' }); }
  });
  function openSettings() { renderSettings(); openSheet($('#settingsSheet')); }
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#bnSettings').addEventListener('click', openSettings);

  $('#themeBtn').addEventListener('click', () => {
    S.setSettings({ theme: resolvedDark() ? 'light' : 'dark' });
    applyTheme();
  });

  // ---------------------------------------------------------------- standup
  function doneSince(ms) { return S.allTasks().filter((t) => t.status === 4 && t.doneAt && t.doneAt >= ms); }

  function standupText(fmt) {
    const s = S.settings;
    const time = (t) => (s.shareFocusInStandup && t.timeSpent >= 60 ? ` (${S.fmtDuration(t.timeSpent)})` : '');
    const who = (t) => (t.assignee && t.assignee !== s.name ? ` → ${t.assignee}` : '');
    const line = (t) => {
      let x = `• ${t.title}${who(t)}${time(t)}`;
      if (t.status === 2) x += ` — ${t.blockedReason || 'reason not set'} (${ageLabel(S.daysSince(t.blockedAt))})`;
      if (t.status !== 4 && t.due && t.due < S.todayISO()) x += ' [overdue]';
      return x;
    };
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const b = fmt === 'slack' ? (x) => `*${x}*` : (x) => x;
    const today0 = startOfToday().getTime();
    const doneToday = S.tasks.filter((t) => t.status === 4).concat(S.state.archive.filter((t) => t.doneAt >= today0));
    const by = (st) => S.tasks.filter((t) => t.status === st).sort((a, c) => a.order - c.order);
    const out = [b(`Standup · ${s.name} · ${date}`), ''];

    if (fmt === 'ytb') {
      const since = today0 - 86400000;
      const done = doneSince(since);
      const today = by(1).concat(by(3), by(0).filter((t) => t.priority === 'high' || (t.due && t.due <= S.todayISO())));
      out.push('Yesterday / done');
      out.push(...(done.length ? done.map(line) : ['• —']));
      out.push('', 'Today');
      out.push(...(today.length ? today.map(line) : ['• Planning the day']));
      out.push('', 'Blockers');
      out.push(...(by(2).length ? by(2).map(line) : ['• None']));
    } else {
      const groups = [[4, doneToday], [3, by(3)], [1, by(1)], [2, by(2)], [0, by(0)]];
      groups.forEach(([st, list]) => {
        if (!list.length) return;
        out.push(b(`${EMOJI[st]} ${STATUS[st]} (${list.length})`));
        out.push(...list.map(line), '');
      });
      if (out[out.length - 1] === '') out.pop();
    }
    out.push('', `Day progress: ${Math.round(S.progress() * 100)}%`);
    return out.join('\n');
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  async function copyStandup() {
    const ok = await copyText(standupText(S.settings.standupFormat));
    const doneN = S.tasks.filter((t) => t.status === 4).length;
    const actions = [{ label: 'Preview', fn: openStandup }];
    if (doneN) actions.push({ label: `Clear ${doneN} done`, fn: clearDone });
    toast(ok ? 'Standup copied. Paste it in team chat.' : 'Copy blocked by the browser — opening preview.', { icon: 'i-copy', actions, timeout: 7000 });
    if (!ok) openStandup();
  }
  function openStandup() {
    renderStandup();
    openModal($('#standupModal'));
  }
  function renderStandup() {
    const fmt = S.settings.standupFormat;
    $$('#suFormat button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fmt === fmt)));
    $('#suText').textContent = standupText(fmt);
  }
  $('#suFormat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmt]');
    if (!b) return;
    S.setSettings({ standupFormat: b.dataset.fmt });
    renderStandup();
  });
  $('#suCopy').addEventListener('click', async () => {
    const ok = await copyText($('#suText').textContent);
    toast(ok ? 'Standup copied' : 'Select the text and copy it manually', { icon: 'i-copy' });
  });
  $('#suClear').addEventListener('click', () => { clearDone(); renderStandup(); });
  $('#standupBtn').addEventListener('click', copyStandup);
  $('#bnStandup').addEventListener('click', openStandup);

  // ---------------------------------------------------------------- insights
  function setView(v) {
    ui.view = v;
    $('#view-board').hidden = v !== 'board';
    $('#view-insights').hidden = v !== 'insights';
    $$('.vtab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $$('.bn[data-view]').forEach((b) => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (v === 'insights') renderInsights();
    try { history.replaceState(null, '', v === 'insights' ? '#insights' : location.pathname + location.search); } catch (e) { /* ignore */ }
    window.scrollTo({ top: 0, behavior: flat() ? 'auto' : 'smooth' });
  }
  $$('.vtab, .bn[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  $('#rangeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    ui.range = +b.dataset.range;
    $$('#rangeSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderInsights();
  });
  $('#loadTableBtn').addEventListener('click', (e) => {
    ui.loadTable = !ui.loadTable;
    e.currentTarget.setAttribute('aria-pressed', String(ui.loadTable));
    e.currentTarget.textContent = ui.loadTable ? 'Chart view' : 'Table view';
    renderInsights();
  });

  function kpi(icon, label, value, sub, warn) {
    return `<div class="kpi glass"><div class="k-label"><svg><use href="#${icon}"/></svg>${label}</div><div class="k-val">${value}</div><div class="k-sub${warn ? ' warn' : ''}">${sub}</div></div>`;
  }

  function renderInsights() {
    const range = ui.range;
    const now = Date.now();
    const from = startOfToday().getTime() - (range - 1) * 86400000;
    const prevFrom = from - range * 86400000;
    const all = S.allTasks();
    const done = all.filter((t) => t.status === 4 && t.doneAt >= from);
    const donePrev = all.filter((t) => t.status === 4 && t.doneAt >= prevFrom && t.doneAt < from).length;
    const blocked = S.tasks.filter((t) => t.status === 2).sort((a, b) => a.blockedAt - b.blockedAt);
    const stale = blocked.filter((t) => S.daysSince(t.blockedAt) >= 2);
    const review = S.tasks.filter((t) => t.status === 3);
    const oldestReview = review.reduce((m, t) => Math.max(m, S.daysSince(t.statusAt)), 0);
    let focus = S.timerElapsed();
    for (let i = 0; i < range; i++) focus += S.state.focusLog[S.todayISO(new Date(now - i * 86400000))] || 0;
    const created = all.filter((t) => t.createdAt >= from);
    const voice = created.length ? Math.round((created.filter((t) => t.source === 'voice').length / created.length) * 100) : 0;
    const delta = done.length - donePrev;

    $('#kpis').innerHTML = [
      kpi('s1', 'Day progress', `${Math.round(S.progress() * 100)}%`, 'weighted by status level'),
      kpi('s4', `Done · ${range}d`, done.length, `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)} vs previous ${range}d`),
      kpi('s2', 'Blocked now', blocked.length, stale.length ? `⚠ ${stale.length} stale over 2 days` : 'none stale', stale.length > 0),
      kpi('s3', 'In review', review.length, review.length ? `oldest ${ageLabel(oldestReview)}` : 'queue clear'),
      kpi('i-clock', `Focus · ${range}d`, S.fmtDuration(focus), `≈ ${S.fmtDuration(Math.round(focus / range))} a day`),
      kpi('i-mic', 'Added by voice', `${voice}%`, 'target 25% or more', voice < 25 && created.length > 3)
    ].join('');

    // Workload by person (all five levels on the current board).
    const me = S.settings.name;
    const people = new Map();
    S.tasks.forEach((t) => {
      const p = t.assignee || me;
      if (!people.has(p)) people.set(p, [0, 0, 0, 0, 0]);
      people.get(p)[t.status]++;
    });
    const rows = [...people.entries()].map(([name, c]) => ({ name, c, total: c.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...rows.map((r) => r.total));
    $('#loadLegend').innerHTML = STATUS.map((n, i) => `<span style="--sc:var(--st${i})"><i></i>${n}</span>`).join('');
    if (ui.loadTable) {
      $('#loadChart').innerHTML = `<table class="data-table"><thead><tr><th>Person</th>${STATUS.map((n) => `<th>${n}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td>${r.c.map((v) => `<td>${v}</td>`).join('')}<td><b>${r.total}</b></td></tr>`).join('')}</tbody></table>`;
    } else {
      $('#loadChart').innerHTML = rows.length ? rows.map((r) => {
        const segs = r.c.map((v, i) => v ? `<div class="hbar-seg" tabindex="0" style="--sc:var(--st${i});width:calc(${(v / max) * 100}% - 2px)" data-tip="${esc(r.name)}|${STATUS[i]}: ${v}" aria-label="${esc(r.name)}, ${STATUS[i]}: ${v}"></div>` : '').join('');
        return `<div class="hbar-row"><div class="hbar-name">${avatar(r.name)}<span>${esc(r.name)}</span></div><div class="hbar-track">${segs}</div><div class="hbar-total">${r.total}</div></div>`;
      }).join('') : '<p class="muted">No tasks yet.</p>';
    }

    // Completed per day.
    const days = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(startOfToday().getTime() - i * 86400000);
      const iso = S.todayISO(d);
      days.push({ d, iso, n: done.filter((t) => S.todayISO(new Date(t.doneAt)) === iso).length });
    }
    const dmax = Math.max(1, ...days.map((x) => x.n));
    const peak = days.reduce((a, b) => (b.n > a.n ? b : a), days[0]);
    $('#weekSub').textContent = `Last ${range} days · ${done.length} total`;
    const wc = $('#weekChart');
    wc.style.setProperty('--n', range);
    wc.style.gap = range > 7 ? '2px' : '6px';
    wc.innerHTML = days.map((x, i) => {
      const showV = range <= 7 ? x.n > 0 : x === peak && x.n > 0;
      const showD = range <= 7 || i % 5 === 0 || i === days.length - 1;
      const label = range <= 7 ? fmtDay(x.d, { weekday: 'short' }) : fmtDay(x.d, { day: 'numeric', month: 'short' });
      return `<div class="col-bar${i === days.length - 1 ? ' today' : ''}" tabindex="0" data-tip="${fmtDay(x.d)}|${x.n} completed" aria-label="${fmtDay(x.d)}: ${x.n} completed">${showV ? `<span class="v">${x.n}</span>` : ''}<div class="bar" style="height:${(x.n / dmax) * 100}%;${range > 7 ? 'width:100%;' : ''}"></div>${showD ? `<span class="d">${label}</span>` : ''}</div>`;
    }).join('');
    wc.parentElement.classList.add('cols-wrap');

    // Blocked list with a one-tap nudge message.
    $('#blockedList').innerHTML = blocked.length ? blocked.map((t) => {
      const age = S.daysSince(t.blockedAt);
      const st = age >= 2;
      return `<li class="${st ? 'stale' : ''}"><svg style="color:var(--st2);margin-top:3px"><use href="#s2"/></svg><div class="li-main"><div class="li-title" data-open="${t.id}">${esc(t.title)}</div><div class="li-sub">${esc(t.blockedReason || 'No reason given')} · ${esc(t.assignee || me)}</div></div><span class="badge${st ? ' stale' : ''}">${ageLabel(age)}${st ? ' stale' : ''}</span><button class="icon-btn" data-nudge="${t.id}" aria-label="Copy a nudge message for ${esc(t.title)}" title="Copy nudge"><svg><use href="#i-send"/></svg></button></li>`;
    }).join('') : '<li class="empty">Nothing blocked right now.</li>';

    const aging = S.tasks.filter((t) => t.status !== 4 && t.status !== 2 && S.daysSince(t.statusAt) >= 3).sort((a, b) => a.statusAt - b.statusAt);
    $('#agingList').innerHTML = aging.length ? aging.map((t) => `<li><svg style="color:var(--st${t.status});margin-top:3px"><use href="#s${t.status}"/></svg><div class="li-main"><div class="li-title" data-open="${t.id}">${esc(t.title)}</div><div class="li-sub">${STATUS[t.status]} · ${esc(t.assignee || me)}</div></div><span class="badge">${ageLabel(S.daysSince(t.statusAt))}</span></li>`).join('') : '<li class="empty">Everything is moving.</li>';

    // Weekly report.
    const byPerson = {};
    done.forEach((t) => { const p = t.assignee || me; byPerson[p] = (byPerson[p] || 0) + 1; });
    const pri = { high: 0, medium: 1, low: 2 };
    const highlights = done.slice().sort((a, b) => pri[a.priority] - pri[b.priority] || b.doneAt - a.doneAt).slice(0, 5);
    const doneVoice = done.length ? Math.round((done.filter((t) => t.source === 'voice').length / done.length) * 100) : 0;
    const period = `${fmtDay(new Date(from), { day: 'numeric', month: 'short' })} – ${fmtDay(new Date(), { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const report = [
      `Dayflow report · ${period}`,
      '',
      `Completed: ${done.length} tasks (${delta >= 0 ? '+' : ''}${delta} vs previous period)`,
      `By person: ${Object.entries(byPerson).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(' · ') || '—'}`,
      '',
      'Highlights',
      ...(highlights.length ? highlights.map((t) => `• ${t.title}${t.assignee ? ` (${t.assignee})` : ''}`) : ['• —']),
      '',
      `In flight: ${S.tasks.filter((t) => t.status === 1).length} in progress · ${review.length} in review · ${S.tasks.filter((t) => t.status === 0).length} queued`,
      `Blocked: ${blocked.length}${stale.length ? ` (${stale.length} older than 2 days)` : ''}`,
      ...blocked.map((t) => `• ${t.title} — ${t.blockedReason || 'no reason'} (${ageLabel(S.daysSince(t.blockedAt))})`),
      '',
      `Focus time: ${S.fmtDuration(focus)} · voice-captured: ${doneVoice}% of completed`
    ].join('\n');
    $('#reportText').textContent = report;
    $('#mailReport').href = `mailto:?subject=${encodeURIComponent(`Dayflow report · ${period}`)}&body=${encodeURIComponent(report)}`;
  }

  $('#view-insights').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { openDetail(o.dataset.open); return; }
    const n = e.target.closest('[data-nudge]');
    if (n) {
      const t = S.get(n.dataset.nudge);
      const who = t.assignee && t.assignee !== S.settings.name ? `Hi ${t.assignee.split(' ')[0]}, ` : 'Hi team, ';
      const msg = `${who}“${t.title}” has been blocked for ${ageLabel(S.daysSince(t.blockedAt))}: ${t.blockedReason || 'no reason noted'}. What would unblock it? Anything I can do?`;
      const ok = await copyText(msg);
      toast(ok ? 'Nudge copied — paste it in chat' : 'Could not copy', { icon: 'i-send' });
    }
  });
  $('#copyReport').addEventListener('click', async () => {
    const ok = await copyText($('#reportText').textContent);
    toast(ok ? 'Weekly report copied' : 'Could not copy', { icon: 'i-copy' });
  });

  // Tooltip for chart marks (hover and keyboard focus).
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  function showTip(el) {
    const [a, b] = el.dataset.tip.split('|');
    tip.innerHTML = `<b>${esc(a)}</b>${esc(b || '')}`;
    const r = el.getBoundingClientRect();
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(innerWidth - w / 2 - 8, Math.max(w / 2 + 8, r.left + r.width / 2))}px`;
    tip.style.top = `${r.top}px`;
  }
  document.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else tip.hidden = true; });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); else tip.hidden = true; });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  // ---------------------------------------------------------------- toasts
  function toast(msg, opts = {}) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${opts.icon ? `<svg class="t-ico"><use href="#${opts.icon}"/></svg>` : ''}<span>${esc(msg)}</span>`;
    const actions = (opts.actions || []).slice();
    if (opts.undo) actions.unshift({ label: 'Undo', fn: doUndo });
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.addEventListener('click', () => { a.fn(); dismiss(); });
      el.appendChild(b);
    });
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    let timer = setTimeout(dismiss, opts.timeout || 4500);
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => { timer = setTimeout(dismiss, 2000); });
    function dismiss() {
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    }
  }

  // ---------------------------------------------------------------- confetti (flat particles with a 3D flip)
  const fx = $('#fx');
  const fxc = fx.getContext('2d');
  let parts = [], fxRaf = 0;
  function confetti(x, y, count = 70) {
    if (flat()) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    fx.width = innerWidth * dpr; fx.height = innerHeight * dpr;
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = statusColors().concat(['#ffd166', '#ff7ad9', '#6d8cff']);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, s: 5 + Math.random() * 6, c: cols[i % cols.length], life: 1 });
    }
    if (!fxRaf) fxRaf = requestAnimationFrame(fxLoop);
  }
  function fxLoop() {
    fxc.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach((p) => {
      p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.012;
      fxc.save();
      fxc.globalAlpha = Math.max(0, p.life);
      fxc.translate(p.x, p.y);
      fxc.rotate(p.r);
      fxc.scale(1, Math.cos(p.r * 3)); // flip on its axis — reads as 3D
      fxc.fillStyle = p.c;
      fxc.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      fxc.restore();
    });
    parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
    if (parts.length) fxRaf = requestAnimationFrame(fxLoop);
    else { fxRaf = 0; fxc.clearRect(0, 0, innerWidth, innerHeight); }
  }

  // ---------------------------------------------------------------- global keyboard
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
    const modalOpen = $$('.modal').some((m) => !m.hidden);
    const sheetOpen = $$('.sheet').some((s) => !s.hidden);
    if (e.key === 'Escape') {
      if (listening) { stopVoice(); return; }
      const m = $$('.modal').find((x) => !x.hidden && x.id !== 'blockedModal');
      if (m) { closeModal(m); return; }
      if (sheetOpen) { closeSheets(); return; }
      if (typing) e.target.blur();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); doUndo(); return; }
    if (typing || modalOpen || sheetOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('.card') && /^[1-5 ]$|^Arrow|^Enter$|^Delete$|^Backspace$/.test(e.key)) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); setView('board'); input.focus(); }
    else if (k === 'v') { e.preventDefault(); toggleVoice(); }
    else if (k === '/') { e.preventDefault(); setView('board'); $('#search').focus(); }
    else if (k === 's') { e.preventDefault(); copyStandup(); }
    else if (k === '?') { e.preventDefault(); openModal($('#helpModal')); }
    else if (k === 'i') { setView(ui.view === 'board' ? 'insights' : 'board'); }
  });
  $('#helpBtn').addEventListener('click', () => openModal($('#helpModal')));

  // ---------------------------------------------------------------- day banner
  function dayBanner(kind) {
    const box = $('#dayBanner');
    const today0 = startOfToday().getTime();
    if (kind === 'welcome') {
      box.innerHTML = `<svg style="color:var(--accent)"><use href="#i-sparkle"/></svg><span>Sample tasks are loaded so you can try everything. Tap the mic and say a few tasks, or press <kbd>?</kbd> for tips.</span><button class="link-btn" data-b="samples">Remove samples</button><button class="icon-btn" data-b="x" aria-label="Dismiss"><svg><use href="#i-x"/></svg></button>`;
    } else if (kind === 'newday') {
      const carried = S.tasks.filter((t) => t.status !== 4).length;
      const blocked = S.tasks.filter((t) => t.status === 2).length;
      const dueToday = S.tasks.filter((t) => t.due === S.todayISO() && t.status !== 4).length;
      const oldDone = S.tasks.filter((t) => t.status === 4 && t.doneAt < today0).length;
      box.innerHTML = `<svg style="color:var(--accent)"><use href="#i-sparkle"/></svg><span>New day. <b>${carried}</b> carried over${blocked ? ` · <b>${blocked}</b> blocked` : ''}${dueToday ? ` · <b>${dueToday}</b> due today` : ''}.</span>` +
        (oldDone ? `<button class="link-btn" data-b="clear">Clear ${oldDone} done from before</button>` : '') +
        `<button class="link-btn" data-b="voice">Plan by voice</button><button class="icon-btn" data-b="x" aria-label="Dismiss"><svg><use href="#i-x"/></svg></button>`;
    } else return;
    box.hidden = false;
  }
  $('#dayBanner').addEventListener('click', (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    const a = b.dataset.b;
    if (a === 'samples') { S.removeSamples(); toast('Samples removed. Your board is ready.', { undo: true, icon: 'i-sparkle' }); }
    if (a === 'clear') clearDone();
    if (a === 'voice') startVoice();
    $('#dayBanner').hidden = true;
  });

  // ---------------------------------------------------------------- init
  function init() {
    const firstRun = !S.state.seeded;
    const prevOpen = S.touchOpen();
    if (firstRun) S.seed();
    applyTheme();
    const orbOk = Orb.init($('#orb'), { reduced: flat(), colors: statusColors() });
    if (!orbOk) document.documentElement.classList.add('no-webgl');
    applyEffects();

    ui.mobileCol = S.tasks.some((t) => t.status === 1) ? 1 : 0;
    S.subscribe(scheduleRender);
    renderAll();
    if (location.hash === '#insights') setView('insights');
    setPlaceholder();
    if (firstRun) dayBanner('welcome');
    else if (prevOpen && prevOpen !== S.todayISO()) dayBanner('newday');

    setInterval(() => {
      if (S.state.timer) tick(); else chimed = false;
    }, 1000);
    // Refresh relative labels (ages, focus totals) once a minute.
    setInterval(() => { if (!document.hidden) scheduleRender(); }, 60000);

    mqPhone.addEventListener('change', () => { setPlaceholder(); scheduleRender(); });
    mqReduce.addEventListener('change', applyEffects);
    mqDark.addEventListener('change', applyTheme);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRender(); });

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    }
    // Ask for notification permission only when a focus session first starts.
    S.subscribe((reason) => {
      if (reason === 'timer' && S.state.timer && S.settings.pomodoro && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    });
  }

  init();
})();
