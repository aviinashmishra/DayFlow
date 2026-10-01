// Run with: npm test   (Node 22+ runs this TypeScript directly)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, parseCommand, resolveDate } from '../lib/parser.ts';

const now = new Date(2026, 8, 30); // Wed 30 Sep 2026
const opts = { now, team: ['Priya Sharma', 'Rahul', 'Avinash'] };
const one = (text: string) => parseInput(text, opts)[0];

test('status and priority words are removed from the title', () => {
  const t = one('Fix checkout bug, high priority, in progress');
  assert.equal(t.title, 'Fix checkout bug');
  assert.equal(t.status, 1);
  assert.equal(t.priority, 'high');
});

test('"next task" splits one recording into several tasks', () => {
  const list = parseInput('fix checkout bug urgent next task call vendor by friday assign to priya next task update pricing page done', opts);
  assert.equal(list.length, 3);
  assert.equal(list[1].title, 'Call vendor');
  assert.equal(list[1].due, '2026-10-02');
  assert.equal(list[1].assignee, 'Priya Sharma');
  assert.equal(list[2].status, 4);
});

test('a status word at the start is a verb, not a status', () => {
  const t = one('Review PR from Rahul');
  assert.equal(t.title, 'Review PR from Rahul');
  assert.equal(t.status, null);
});

test('blocked reason is captured', () => {
  const t = one('API migration blocked by vendor keys urgent');
  assert.equal(t.title, 'API migration');
  assert.equal(t.status, 2);
  assert.equal(t.blockedReason, 'Vendor keys');
  assert.equal(t.priority, 'high');
});

test('tags, mentions and filler words', () => {
  const t = one('add a task to send invoice tomorrow #finance @rahul');
  assert.equal(t.title, 'Send invoice');
  assert.deepEqual(t.tags, ['finance']);
  assert.equal(t.assignee, 'Rahul');
  assert.equal(t.due, '2026-10-01');
});

test('Hindi-English mixed speech', () => {
  const list = parseInput('report bhejna hai kal tak zaroori agla task deploy ho gaya', opts);
  assert.equal(list.length, 2);
  assert.equal(list[0].due, '2026-10-01');
  assert.equal(list[0].priority, 'high');
  assert.equal(list[1].status, 4);
});

test('"working on" sets in progress and keeps the rest as title', () => {
  const t = one('working on the onboarding deck');
  assert.equal(t.status, 1);
  assert.equal(t.title, 'Onboarding deck');
});

test('natural spoken sentences keep a readable title', () => {
  const cases: Array<[string, string, number | null]> = [
    ['we are working on the app', 'Work on the app', 1],
    ["I'm working on the checkout page redesign", 'Checkout page redesign', 1],
    ['we are working on the app.', 'Work on the app', 1],
    ['Priya is working on the design', 'Priya is working on the design', 1],
    ['okay so we need to fix the login page please', 'Fix the login page', null],
    ['we are done with the quarterly report', 'The quarterly report', 4],
    ["let's update the pricing page thanks", 'Update the pricing page', null],
    ['can you add a task to call the vendor', 'Call the vendor', null],
    ['remind me to send the invoice', 'Send the invoice', null]
  ];
  for (const [said, title, status] of cases) {
    const t = one(said);
    assert.ok(t, `nothing parsed from "${said}"`);
    assert.equal(t.title, title, said);
    assert.equal(t.status, status, said);
  }
});

test('a sentence is never dropped even if it is all keywords', () => {
  const t = one('we are blocked on the API keys');
  assert.equal(t.status, 2);
  assert.equal(t.blockedReason, 'The API keys');
  assert.equal(t.title, 'API keys');
});

test('pure filler never becomes a task', () => {
  assert.deepEqual(parseInput('um', opts), []);
  assert.deepEqual(parseInput('okay so', opts), []);
  const list = parseInput('okay so first task fix the navbar urgent second task call the vendor tomorrow and we are', opts);
  assert.deepEqual(list.map((t) => t.title), ['Fix the navbar', 'Call the vendor']);
});

test('ordinal "first task / second task" splits too', () => {
  const list = parseInput('first task fix the navbar second task write release notes', opts);
  assert.deepEqual(list.map((t) => t.title), ['Fix the navbar', 'Write release notes']);
});

test('dates', () => {
  assert.equal(resolveDate('by friday', now), '2026-10-02');
  assert.equal(resolveDate('next wednesday', now), '2026-10-07');
  assert.equal(resolveDate('15th october', now), '2026-10-15');
  assert.equal(resolveDate('in 3 days', now), '2026-10-03');
  assert.equal(resolveDate('5/10', now), '2026-10-05');
  assert.equal(resolveDate('next week', now), '2026-10-05');
});

test('commands update existing tasks', () => {
  const tasks = [{ id: '1', title: 'Fix checkout bug' }, { id: '2', title: 'Write the quarterly report' }];
  assert.deepEqual(parseCommand('mark checkout bug as done', tasks, opts)?.changes, { status: 4 });
  assert.equal(parseCommand('move quarterly report to review', tasks, opts)?.taskId, '2');
  const start = parseCommand('start checkout bug', tasks, opts);
  assert.equal(start?.timer, 'start');
  assert.equal(parseCommand('pause timer', tasks, opts)?.timer, 'pause');
  assert.equal(parseCommand('Finish onboarding deck', tasks, opts), null);
});
