// End-to-end API test against a running server and the real database.
// Usage: npm run build && npm start   (in another terminal)
//        npm run test:api              (BASE_URL defaults to http://localhost:3000)
// Creates throwaway organizations (emails e2e+t40-…@dayflow.test) and deletes them at the end.
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const sql = neon(process.env.DATABASE_URL);
const stamp = Date.now();
const mail = (who) => `e2e+t40-${who}${stamp}@dayflow.test`;
let pass = 0, fail = 0;
const orgs = new Set();

function check(ok, msg, extra) {
  if (ok) { pass++; console.log(`PASS ${msg}`); }
  else { fail++; console.log(`FAIL ${msg}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: BASE, ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual'
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch { /* none */ }
    return { status: res.status, data };
  };
  call.cookie = () => cookie;
  return call;
}

const A = client(), B = client(), C = client(), D = client(), anon = client();
const board = async (c) => (await c('GET', '/api/board')).data;
const notes = async (c) => (await c('GET', '/api/notifications')).data;
// New organizations get private "getting started" cards (tag #start); most checks ignore them.
const own = (b) => b.tasks.filter((t) => !t.tags.includes('start'));

try {
  // ---------- organizations, invites, sign-up
  let r = await A('POST', '/api/auth/signup', { name: 'Avi Owner', email: mail('a'), password: 'correct horse 1', orgName: 'E2E Org', firstTeam: 'Engineering' });
  check(r.status === 201, 'A signs up and creates an organization', r);
  let bA = await board(A);
  orgs.add(bA.org.id);
  const eng = bA.teams[0];
  check(bA.me.role === 'owner' && bA.org.name === 'E2E Org' && /^[A-Z0-9]{8}$/.test(bA.org.inviteCode), 'A is the owner and sees the invite code');
  check(bA.teams.length === 1 && eng.name === 'Engineering' && bA.me.teams[0]?.teamId === eng.id && bA.me.teams[0]?.role === 'lead', 'the first team is created and A leads it');
  const invite = bA.org.inviteCode;

  r = await B('POST', '/api/auth/signup', { name: 'Priya Member', email: mail('b'), password: 'correct horse 2', inviteCode: invite.toLowerCase(), teamId: eng.id });
  check(r.status === 201, 'B joins with the invite code and a team link', r);
  let bB = await board(B);
  const idA = bA.me.id, idB = bB.me.id;
  check(bB.org.id === bA.org.id && bB.me.role === 'member' && bB.me.teams.some((m) => m.teamId === eng.id && m.role === 'member'), 'B is a member of the organization and of Engineering');
  check(bB.org.inviteCode === null, 'members do not receive the invite code');

  r = await D('POST', '/api/auth/signup', { name: 'Dev Lead', email: mail('d'), password: 'correct horse 4', inviteCode: invite });
  const idD = (await board(D)).me.id;
  check(r.status === 201, 'D joins without a team link (lands in the oldest team)');

  r = await anon('POST', '/api/auth/signup', { name: 'Dup', email: mail('b').toUpperCase(), password: 'another pass' });
  check(r.status === 409, 'duplicate email is rejected (case-insensitive)', r.status);
  r = await anon('POST', '/api/auth/signup', { name: 'X', email: mail('x'), password: 'longenough', inviteCode: 'NOPE0000' });
  check(r.status === 400, 'unknown invite code is rejected', r.status);
  r = await anon('POST', '/api/auth/signup', { name: 'X', email: 'not-an-email', password: 'short' });
  check(r.status === 400, 'invalid signup input is rejected', r.status);

  // ---------- teams
  r = await A('POST', '/api/teams', { name: 'Design', description: 'Product design', color: '#c23d72' });
  const design = r.data?.team;
  check(r.status === 201 && design?.name === 'Design' && design.color === '#c23d72', 'the owner creates a Design team', r);
  check((await B('POST', '/api/teams', { name: 'Rogue' })).status === 403, 'members cannot create teams');
  check((await A('POST', '/api/teams', { name: 'design' })).status === 409, 'team names are unique (case-insensitive)');
  r = await A('PUT', `/api/teams/${design.id}/members/${idD}`, { role: 'lead' });
  check(r.status === 200, 'the owner makes D lead of Design');
  check((await notes(D)).notifications.some((n) => n.kind === 'team' && /Design/.test(n.text)), 'D is notified about joining Design');
  check((await B('PUT', `/api/teams/${design.id}/members/${idB}`, {})).status === 403, 'a member cannot add people to a team they do not lead');
  r = await D('PUT', `/api/teams/${design.id}/members/${idB}`, { role: 'member' });
  check(r.status === 200 && (await board(B)).me.teams.some((m) => m.teamId === design.id), 'the Design lead adds B to Design');
  check((await D('PATCH', `/api/teams/${design.id}`, { description: 'Brand and product design' })).status === 200, 'a team lead edits their team');
  check((await B('PATCH', `/api/teams/${design.id}`, { name: 'Hacked' })).status === 403, 'a member cannot edit a team');
  check((await D('PATCH', `/api/teams/${eng.id}`, { name: 'Hacked' })).status === 403, 'a lead cannot edit another team');

  // ---------- tasks with teams, assignment notifications, idempotent create
  const t1 = randomUUID(), t2 = randomUUID(), t3 = randomUUID();
  const payload = { tasks: [
    { id: t1, title: 'Fix checkout bug', status: 1, priority: 'high', source: 'voice', position: -3, teamId: eng.id },
    { id: t2, title: 'Send invoice', status: 0, dueDate: '2026-10-02', assigneeId: idB, tags: ['finance'], position: -2, teamId: eng.id },
    { id: t3, title: 'Design review', status: 2, blockedReason: 'Missing specs', position: -1, teamId: design.id }
  ] };
  r = await A('POST', '/api/tasks', payload);
  check(r.status === 201 && r.data.tasks.length === 3 && r.data.tasks.find((t) => t.id === t3).teamId === design.id, 'A creates 3 tasks in two teams', r.status);
  await A('POST', '/api/tasks', payload);
  bA = await board(A);
  check(own(bA).length === 3, 'replaying the same create (offline retry) makes no duplicates', own(bA).length);
  const bNotes = await notes(B);
  check(bNotes.notifications.filter((n) => n.kind === 'assigned' && n.taskId === t2).length === 1, 'B is notified once about the task assigned to them (not again on replay)', bNotes);
  check((await A('POST', '/api/tasks', { tasks: [{ id: randomUUID(), title: 'x', assigneeId: randomUUID() }] })).status === 400, 'assigning to someone outside the organization is rejected');
  check((await A('POST', '/api/tasks', { tasks: [{ id: randomUUID(), title: 'x', teamId: randomUUID() }] })).status === 400, 'a team outside the organization is rejected');
  check(JSON.stringify((await board(B)).tasks.map((t) => t.id).sort()) === JSON.stringify([t1, t2, t3].sort()), 'B sees the same organization board');

  // ---------- updates, derived fields, notifications
  r = await A('PATCH', `/api/tasks/${t1}`, { status: 3, reviewerId: idB });
  check(r.status === 200 && r.data.task.status === 3 && r.data.task.reviewerId === idB, 'A moves a task to Review and names a reviewer');
  check((await notes(B)).notifications.some((n) => n.kind === 'review' && n.taskId === t1), 'the reviewer is notified');
  r = await B('PATCH', `/api/tasks/${t1}`, { status: 4 });
  check(r.data.task.status === 4 && r.data.task.doneAt, 'B marks it Done (doneAt set)');
  check((await notes(A)).notifications.some((n) => n.kind === 'status' && n.taskId === t1 && /Done/.test(n.text)), 'the task owner hears that B finished it');
  r = await B('PATCH', `/api/tasks/${t1}`, { status: 1 });
  check(r.data.task.doneAt === null, 'moving back clears doneAt');
  r = await A('PATCH', `/api/tasks/${t2}`, { status: 2, blockedReason: 'Waiting on finance', teamId: design.id });
  check(r.data.task.teamId === design.id, 'a task moves to another team');
  check((await notes(D)).notifications.some((n) => n.kind === 'blocked' && n.taskId === t2 && /Waiting on finance/.test(n.text)), 'the team lead is told when a task in their team is blocked');
  r = await A('GET', `/api/tasks/${t2}`);
  check(r.data.activity.some((a) => /Moved to the Design team/.test(a.change)), 'the team move is in the task history');
  check((await A('PATCH', `/api/tasks/${t2}`, { title: '  ', status: 9 })).status === 400, 'invalid update is rejected');

  // ---------- focus timer
  r = await A('POST', '/api/timer', { action: 'start', taskId: t1 });
  check(r.status === 200 && r.data.timer.taskId === t1, 'focus timer starts');
  await new Promise((res) => setTimeout(res, 1200));
  r = await A('POST', '/api/timer', { action: 'start', taskId: t3 });
  check(r.data.timer.taskId === t3 && r.data.tasks.find((t) => t.id === t1).timeSpent >= 1, 'starting another timer books time on the first (one timer at a time)');
  r = await A('POST', '/api/timer', { action: 'stop' });
  check(r.data.timer === null && (await board(A)).focus.length >= 2, 'timer stops and sessions are recorded');

  // ---------- comments and mentions
  r = await B('POST', `/api/tasks/${t3}/comments`, { text: 'Specs are in the drive. @Avi can you check?' });
  check(r.status === 201 && r.data.comment.authorName === 'Priya Member', 'B comments');
  check((await notes(A)).notifications.some((n) => n.kind === 'mention' && n.taskId === t3), '@mentions notify the person mentioned');
  r = await A('GET', `/api/tasks/${t3}`);
  check(r.data.comments.length === 1 && r.data.task.commentCount === 1 && r.data.activity.some((a) => a.change === 'Comment added'), 'detail returns comments, activity and count');

  // ---------- detailed tasks & attachments (still work at org scope)
  const t4 = randomUUID();
  r = await A('POST', '/api/tasks', { tasks: [{ id: t4, title: 'Write launch brief', description: 'Goals, audience, dates.', links: [{ url: 'https://example.com/spec', label: 'Spec' }], teamId: eng.id }] });
  check(r.status === 201 && r.data.tasks[0].links[0].label === 'Spec', 'task with description and links');
  check((await A('POST', '/api/tasks', { tasks: [{ id: randomUUID(), title: 'x', links: [{ url: 'javascript:alert(1)' }] }] })).status === 400, 'non-http links are rejected');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  r = await A('POST', `/api/tasks/${t4}/attachments`, { name: 'pixel.png', type: 'image/png', data: png.toString('base64') });
  const att = r.data?.attachment;
  check(r.status === 201 && att.size === png.length, 'file attached');
  const f = await fetch(`${BASE}/api/tasks/${t4}/attachments/${att.id}`, { headers: { Cookie: B.cookie() } });
  check(f.status === 200 && Buffer.from(await f.arrayBuffer()).equals(png), 'a colleague downloads it byte-for-byte');
  check((await B('DELETE', `/api/tasks/${t4}/attachments/${att.id}`)).status === 403, 'a member cannot remove someone else’s file');

  // ---------- delete / restore / clear with team leads
  check((await B('DELETE', `/api/tasks/${t4}`)).status === 403, 'a member cannot delete a task they neither created nor own');
  r = await D('DELETE', `/api/tasks/${t3}`);
  check(r.status === 200, 'a team lead deletes a task in their team');
  check((await D('DELETE', `/api/tasks/${t4}`)).status === 403, 'a team lead cannot delete tasks in other teams');
  r = await D('POST', `/api/tasks/${t3}/restore`, {});
  check(r.status === 200 && (await A('GET', `/api/tasks/${t3}`)).data.activity.some((a) => a.change === 'Restored'), 'the lead restores it (and it is in the history)');
  await A('PATCH', `/api/tasks/${t3}`, { status: 4 });
  check((await B('POST', '/api/tasks/archive', { ids: [t3] })).data.ids.length === 0, 'a member cannot clear someone else’s done task');
  r = await D('POST', '/api/tasks/archive', { ids: [t3] });
  check(r.data.ids[0] === t3 && (await board(A)).archived.some((t) => t.id === t3), 'the team lead clears it: archived, kept for reports');
  check((await D('POST', '/api/tasks/unarchive', { ids: [t3] })).data.ids[0] === t3, 'undo clear brings it back');

  // ---------- profile & settings
  r = await B('PATCH', '/api/me', { title: 'Product Designer', settings: { theme: 'dark', pomodoro: 45 } });
  check(r.data.me.title === 'Product Designer' && r.data.me.settings.theme === 'dark' && r.data.me.settings.lang === 'en-IN', 'job title and settings save');
  check((await B('PATCH', '/api/me', { settings: { evil: true } })).status === 400, 'unknown settings are rejected');
  check((await board(A)).members.find((m) => m.id === idB).title === 'Product Designer', 'the directory shows the job title');

  // ---------- organization roles
  check((await B('PATCH', `/api/people/${idA}`, { role: 'member' })).status === 403, 'a member cannot change roles');
  check((await A('PATCH', `/api/people/${idA}`, { role: 'member' })).status === 400, 'nobody can change their own role');
  r = await A('PATCH', `/api/people/${idB}`, { role: 'admin' });
  check(r.data.member.role === 'admin' && (await board(B)).org.inviteCode === invite, 'the owner makes B an admin; admins see the invite code');
  check((await B('PATCH', `/api/people/${idD}`, { role: 'owner' })).status === 403, 'an admin cannot grant the owner role');
  check((await B('PATCH', `/api/people/${idA}`, { role: 'admin' })).status === 403, 'an admin cannot demote the owner');
  check((await B('DELETE', `/api/people/${idA}`)).status === 403, 'an admin cannot deactivate the owner');
  check((await A('PATCH', `/api/people/${idB}`, { role: 'member' })).data.member.role === 'member', 'the owner sets B back to member');

  // ---------- deactivation
  check((await B('DELETE', `/api/people/${idD}`)).status === 403, 'members cannot deactivate people');
  check((await A('DELETE', `/api/people/${idD}`)).status === 200, 'the owner deactivates D');
  check((await D('GET', '/api/board')).status === 401, 'D’s session ends immediately');
  const again = await anon('POST', '/api/auth/login', { email: mail('d'), password: 'correct horse 4' });
  check(again.status === 403 && /deactivated/.test(again.data.error), 'D cannot sign in and is told why');
  check((await A('POST', '/api/tasks', { tasks: [{ id: randomUUID(), title: 'x', assigneeId: idD }] })).status === 400, 'deactivated people cannot be assigned');
  bA = await board(A);
  check(bA.members.find((m) => m.id === idD).active === false && bA.members.find((m) => m.id === idD).teams.length === 0, 'the directory shows D as deactivated, removed from teams');
  check((await A('POST', `/api/people/${idD}/reactivate`, {})).status === 200 && (await D('POST', '/api/auth/login', { email: mail('d'), password: 'correct horse 4' })).status === 200, 'reactivated, D can sign in again');

  // ---------- notifications
  let n = await notes(B);
  check(n.unread > 0 && n.notifications.every((x) => x.id && x.text), 'B has unread notifications');
  r = await B('POST', '/api/notifications/read', { ids: [n.notifications[0].id] });
  check(r.data.marked === 1 && (await notes(B)).unread === n.unread - 1, 'mark one as read');
  await B('POST', '/api/notifications/read', {});
  check((await notes(B)).unread === 0, 'mark all as read');

  // ---------- team deletion & leaving
  check((await B('DELETE', `/api/teams/${eng.id}/members/${idB}`)).status === 200, 'anyone can leave a team');
  check((await D('DELETE', `/api/teams/${design.id}`)).status === 403, 'only admins delete teams');
  r = await A('DELETE', `/api/teams/${design.id}`);
  bA = await board(A);
  check(r.status === 200 && !bA.teams.some((t) => t.id === design.id) && bA.tasks.find((t) => t.id === t2).teamId === null, 'deleting a team keeps its tasks, without a team');

  // ---------- audit log
  r = await A('GET', '/api/audit');
  const actions = r.data.entries.map((e) => e.action);
  check(['org.created', 'member.joined', 'team.created', 'team.member_added', 'member.role', 'member.deactivated', 'member.reactivated', 'team.deleted'].every((x) => actions.includes(x)), 'the audit log records people, roles and teams', [...new Set(actions)]);
  check(r.data.entries.some((e) => e.source === 'task' && e.taskTitle === 'Fix checkout bug'), 'task changes appear in the audit log with the task title');
  check((await A('GET', '/api/audit?kind=org')).data.entries.every((e) => e.source === 'org'), 'the audit log can be filtered');
  check((await B('GET', '/api/audit')).status === 403, 'members cannot read the audit log');

  // ---------- organization settings & invite
  check((await B('PATCH', '/api/org', { name: 'Hacked' })).status === 403, 'members cannot rename the organization');
  check((await A('PATCH', '/api/org', { name: 'E2E Renamed' })).status === 200 && (await board(B)).org.name === 'E2E Renamed', 'the owner renames the organization');
  r = await A('POST', '/api/org/invite', {});
  check(r.data.inviteCode && r.data.inviteCode !== invite, 'a new invite code is issued');
  check((await anon('POST', '/api/auth/signup', { name: 'Late', email: mail('late'), password: 'longenough', inviteCode: invite })).status === 400, 'the old invite code stops working');

  // ---------- isolation between organizations
  r = await C('POST', '/api/auth/signup', { name: 'Outsider', email: mail('c'), password: 'correct horse 3' });
  const bC = await board(C);
  orgs.add(bC.org.id);
  check(own(bC).length === 0 && bC.tasks.every((t) => t.private) && bC.members.length === 1 && bC.teams.length === 1, 'another organization starts empty (only its own private starter cards)');
  check((await C('GET', `/api/tasks/${t2}`)).status === 404, 'another organization cannot read our task');
  check((await C('PATCH', `/api/tasks/${t2}`, { title: 'hacked' })).status === 404, 'another organization cannot edit our task');
  check((await C('PUT', `/api/teams/${eng.id}/members/${bC.me.id}`, {})).status === 404, 'another organization cannot join our teams');
  check((await C('PATCH', `/api/people/${idB}`, { role: 'admin' })).status === 404, 'another organization cannot touch our people');
  check((await C('POST', '/api/tasks', { tasks: [{ id: t2, title: 'steal id' }] })).status === 201 && (await A('GET', `/api/tasks/${t2}`)).data.task.title === 'Send invoice', 'reusing our task id from another organization changes nothing');

  // ---------- personal spaces: one person, private tasks, then a team
  const P = client(), Q = client();
  r = await P('POST', '/api/auth/signup', { name: 'Solo Person', email: mail('p'), password: 'correct horse 5', mode: 'personal' });
  check(r.status === 201, 'P signs up for a personal space', r);
  let bP = await board(P);
  orgs.add(bP.org.id);
  check(bP.org.kind === 'personal' && bP.teams.length === 0 && bP.me.role === 'owner' && bP.members.length === 1, 'the personal space has no teams and P owns it', bP.org);
  check(bP.tasks.length >= 4 && bP.tasks.every((t) => t.private && t.creatorId === bP.me.id), 'starter tasks are seeded, all private', bP.tasks.length);
  const solo = randomUUID(), later = randomUUID();
  r = await P('POST', '/api/tasks', { tasks: [{ id: solo, title: 'Plan the launch', private: false }, { id: later, title: 'Buy groceries' }] });
  check(r.status === 201 && r.data.tasks.every((t) => t.private), 'every task in a personal space is private, even if asked otherwise', r.data);
  check((await P('POST', '/api/teams', { name: 'Sneaky' })).status === 409, 'a personal space cannot add teams without teaming up');
  r = await anon('POST', '/api/auth/signup', { name: 'Gatecrasher', email: mail('g'), password: 'correct horse 6', inviteCode: bP.org.inviteCode });
  check(r.status === 400, 'nobody can join a personal space with its code', r.status);

  r = await P('POST', '/api/org/team-up', { orgName: 'Solo Labs', team: { name: 'Launch', color: '#c23d72' }, taskIds: [solo] });
  const launch = r.data?.team;
  check(r.status === 201 && launch?.name === 'Launch' && r.data.moved === 1 && /^[A-Z0-9]{8}$/.test(r.data.inviteCode), 'P turns the space into a team workspace and shares one task', r);
  bP = await board(P);
  check(bP.org.kind === 'team' && bP.org.name === 'Solo Labs' && bP.me.teams.some((m) => m.teamId === launch.id && m.role === 'lead'), 'the workspace is renamed and P leads the new team');
  check(bP.tasks.find((t) => t.id === solo)?.teamId === launch.id && !bP.tasks.find((t) => t.id === solo)?.private, 'the chosen task is shared with the team');
  check(bP.tasks.find((t) => t.id === later)?.private === true, 'tasks not chosen stay private');
  check((await P('POST', '/api/org/team-up', { orgName: 'Again', team: { name: 'Twice' } })).status === 409, 'teaming up twice is refused');

  r = await Q('POST', '/api/auth/signup', { name: 'Quinn Joiner', email: mail('q'), password: 'correct horse 7', inviteCode: bP.org.inviteCode, teamId: launch.id });
  check(r.status === 201, 'Q joins the new team with its invite link', r);
  let bQ = await board(Q);
  const idQ = bQ.me.id;
  check(bQ.tasks.some((t) => t.id === solo) && !bQ.tasks.some((t) => t.private), 'Q sees the shared task and none of P’s private ones');
  check((await Q('GET', `/api/tasks/${later}`)).status === 404, 'a private task is invisible to teammates (read)');
  check((await Q('PATCH', `/api/tasks/${later}`, { title: 'peek' })).status === 404, 'a private task is invisible to teammates (edit)');
  check((await Q('POST', `/api/tasks/${later}/comments`, { text: 'hi' })).status === 404, 'a private task is invisible to teammates (comment)');
  check((await Q('POST', '/api/timer', { action: 'start', taskId: later })).status === 404, 'a private task is invisible to teammates (focus timer)');
  check((await Q('POST', '/api/tasks', { tasks: [{ id: later, title: 'id reuse' }] })).data?.tasks?.length === 0, 'reusing a private task id reveals nothing');
  check(((await Q('POST', '/api/tasks/archive', { ids: [later] })).data?.ids ?? []).length === 0, 'teammates cannot archive a private task');

  r = await P('POST', '/api/tasks', { tasks: [{ id: randomUUID(), title: 'Secret for Quinn', private: true, assigneeId: idQ }] });
  check(r.status === 400, 'a private task cannot be assigned to someone else', r.status);
  r = await P('POST', '/api/tasks', { tasks: [{ id: randomUUID(), title: 'Private in a team', private: true, teamId: launch.id }] });
  check(r.status === 400, 'a private task cannot belong to a team', r.status);
  const mine = randomUUID();
  r = await P('POST', '/api/tasks', { tasks: [{ id: mine, title: 'My own note', private: true }] });
  check(r.status === 201 && r.data.tasks[0].private, 'in a team workspace you can still add private tasks');

  r = await P('PATCH', `/api/tasks/${solo}`, { private: true, teamId: null, assigneeId: null });
  check(r.status === 200 && r.data.task.private && !r.data.task.teamId, 'P takes a shared task back to private');
  check(!(await board(Q)).tasks.some((t) => t.id === solo), 'it disappears from Q’s board');
  r = await P('PATCH', `/api/tasks/${mine}`, { teamId: launch.id });
  check(r.status === 200 && !r.data.task.private && r.data.task.teamId === launch.id, 'filing a private task under a team shares it');
  check((await board(Q)).tasks.some((t) => t.id === mine), 'and Q can now see it');
  const qTask = randomUUID();
  await Q('POST', '/api/tasks', { tasks: [{ id: qTask, title: 'Quinn’s task', teamId: launch.id }] });
  check((await P('PATCH', `/api/tasks/${qTask}`, { private: true, teamId: null })).status === 403, 'only the creator can make a task private');

  // ---------- sessions & request guards
  check((await anon('GET', '/api/board')).status === 401, 'signed-out requests get 401');
  check((await anon('POST', '/api/auth/login', { email: mail('a'), password: 'wrong' })).status === 401, 'wrong password is rejected');
  const L = client();
  check((await L('POST', '/api/auth/login', { email: mail('a').toUpperCase(), password: 'correct horse 1' })).status === 200 && (await L('GET', '/api/board')).status === 200, 'sign in works (email is case-insensitive)');
  await L('POST', '/api/auth/logout', {});
  check((await L('GET', '/api/board')).status === 401, 'sign out ends the session');
  check((await A('PATCH', `/api/tasks/${t2}`, { title: 'x' }, { Origin: 'https://evil.example' })).status === 403, 'cross-site writes are blocked');
  const plain = await fetch(BASE + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: BASE }, body: '{}' });
  check(plain.status === 415, 'non-JSON writes are refused', plain.status);
  const page = await fetch(BASE + '/', { redirect: 'manual' });
  check(page.status === 307 && (page.headers.get('location') || '').includes('/login'), 'the board page redirects to sign in when signed out', page.status);
} catch (e) {
  fail++;
  console.log('FAIL exception', e);
} finally {
  for (const id of orgs) await sql`DELETE FROM organizations WHERE id = ${id}`;
  await sql`DELETE FROM users WHERE email LIKE ${'e2e+t40-%' + stamp + '@dayflow.test'}`;
  console.log(`\n${pass} passed, ${fail} failed (test data removed)`);
  process.exit(fail ? 1 : 0);
}
