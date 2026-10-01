/*
 * Dayflow natural-language parser.
 * Turns a typed line or a voice transcript into one or more tasks, or into a
 * command that updates an existing task ("mark checkout bug as done").
 * Pure and dependency-free: used by the client and by the unit tests.
 */
import type { Priority, Status } from './types';

export interface ParsedTask {
  title: string;
  status: Status | null;
  priority: Priority | null;
  due: string | null;
  assignee: string | null;
  tags: string[];
  project: string | null;
  blockedReason: string | null;
  raw: string;
}

export interface ParseOptions {
  team?: string[];
  now?: Date;
}

export interface CommandChanges {
  status?: Status;
  priority?: Priority;
  due?: string;
  assignee?: string;
  blockedReason?: string;
  tags?: string[];
}

export interface ParsedCommand {
  taskId: string | null;
  title?: string;
  changes: CommandChanges;
  timer: 'start' | 'pause' | null;
  verb: string;
  score: number;
}

const SEP = '\u0001';
// Word boundaries that also work for Devanagari (\b does not).
const PRE = '(^|[\\s,.;:!?()\\u0001])';
const POST = '(?=$|[\\s,.;:!?()\\u0001])';

function rx(src: string, flags = 'i'): RegExp {
  return new RegExp(PRE + '(' + src + ')' + POST, flags);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WD_SHORT = [['sun'], ['mon'], ['tue', 'tues'], ['wed'], ['thu', 'thur', 'thurs'], ['fri'], ['sat']];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_SHORT = [['jan'], ['feb'], ['mar'], ['apr'], ['may'], ['jun'], ['jul'], ['aug'], ['sep', 'sept'], ['oct'], ['nov'], ['dec']];
const NUMWORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, couple: 2, few: 3 };

const WD_FULL = WEEKDAYS.join('|');
const WD_ANY = WEEKDAYS.map((d, i) => d + '|' + WD_SHORT[i].join('|')).join('|');
const MON_ANY = MONTHS.map((m, i) => m + '|' + MON_SHORT[i].join('|')).join('|');
const ORD = '(?:st|nd|rd|th)?';
const NUMW = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an|a couple of|a few)';

// Date phrases that are safe on their own ("call vendor tomorrow").
const DATE_BARE =
  'day after tomorrow|parso|परसों|' +
  'end of (?:the )?day|eod|tonight|today|aaj|आज|' +
  'tomorrow|tmrw|tmr|kal|कल|' +
  'end of (?:the )?week|eow|this weekend|weekend|' +
  'end of (?:the )?month|eom|' +
  'next week|agle hafte|अगले हफ्ते|' +
  'in ' + NUMW + ' (?:days?|weeks?)|' +
  '(?:next |this |coming )?(?:' + WD_FULL + ')|' +
  '\\d{1,2}' + ORD + ' (?:of )?(?:' + MON_ANY + ')|' +
  '(?:' + MON_ANY + ') \\d{1,2}' + ORD;
// Extra phrases that need a lead word ("by fri", "due the 15th", "by 5/10").
const DATE_LEAD = DATE_BARE + '|(?:next |this |coming )?(?:' + WD_ANY + ')|(?:the )?\\d{1,2}' + ORD + '|\\d{1,2}/\\d{1,2}';

const P = {
  split: /(?:^|[\s,.;:!?])(?:next task|new task|another task|next one|(?:first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th) task|task (?:number )?(?:one|two|three|four|five|six|[1-6])|also add|then add|agla task|अगला टास्क|अगला काम)(?=$|[\s,.;:!?])|[\n;]+/gi,
  lowPri: rx('low priority|priority low|low pri|not urgent|no rush|whenever|someday|p3'),
  medPri: rx('medium priority|normal priority|priority medium|priority normal|p2'),
  highPri: rx('high priority|top priority|priority high|highest priority|urgent|urgently|asap|critical|important|p0|p1|zaroori|jaruri|ज़रूरी|जरूरी'),
  dueLead: rx('(?:due(?: by| on)?|by|before|until|till|deadline(?: is)?)\\s+(?:' + DATE_LEAD + ')(?:\\s+(?:tak|तक))?'),
  dueBare: rx('(?:' + DATE_BARE + ')(?:\\s+(?:tak|तक))?'),
  assign: rx('(?:assign(?:ed)?|give|delegate|hand)(?:\\s+(?:it|this|this task|task))?\\s+to\\s+[^\\s,.;:!?\\u0001]+(?:\\s+[^\\s,.;:!?\\u0001]+)?'),
  atMention: /(^|\s)@([\w.\-]+)/,
  hashTag: /(^|\s)#([\w\-]+)/,
  voiceTag: rx('(?:tag|tagged|hashtag|label)\\s+[\\w\\-]+'),
  project: rx('(?:(?:for|in|under)\\s+)?(?:the\\s+)?project\\s+[\\w\\-]+'),
  blockedWhy: /^\s*(?:by|on|for|because of|because|due to|until|since|as|till)\s+/i
};

const STATUS_PHRASES: Array<[Status, string]> = [
  // Multi-word phrases first so "in review" wins over "review".
  [3, 'ready for review|needs review|needs a review|send for review|sent for review|awaiting review|in review|for review|under review'],
  [1, 'work in progress|in progress|working on|currently doing|chal raha hai|chal raha|चल रहा है|चल रहा|wip|started|ongoing'],
  [2, 'on hold|atka hua hai|atka hua|atka|ruka hua|अटका हुआ|अटका|रुका हुआ|blocked|stuck|waiting'],
  [4, 'done with|finished with|completed with|ho gaya hai|ho gaya|ho gya|पूरा हो गया|हो गया|khatam|खत्म|done|finished|completed|complete'],
  [0, 'todo|backlog|queued|baad mein|बाद में|later'],
  [3, 'review']
];
const STATUS_RX = STATUS_PHRASES.map(([level, src]) => ({ level, re: rx(src) }));
const BLOCKED_RX = rx('on hold|atka hua hai|atka hua|atka|ruka hua|अटका हुआ|अटका|रुका हुआ|blocked|stuck|waiting');

// Spoken lead-ins that are not part of the task ("okay so we need to …").
const FILLER_START = /^\s*(?:(?:ok(?:ay)?|hey|hi|hello|so|um+|uh+|umm+|hmm+|erm|and|also|then|well|right)(?:[,.!\s]+|$))*(?:(?:please|can you|could you|kindly)\s+)?(?:(?:add|create|new|make|log|put)(?:\s+(?:a|an|the|one))?(?:\s+new)?\s+(?:task|todo|item|to-do)(?:\s+(?:to|called|named|for|that says|saying))?[:,]?\s+|remind me to\s+|remember to\s+|don'?t forget to\s+|(?:i|we) (?:need|have|want|must|should|would like|ought) to\s+|(?:i|we)(?:'ve| have)? got to\s+|(?:i|we) gotta\s+|(?:i|we)'ll\s+|(?:i|we) will\s+|let'?s\s+|let us\s+|task[:,]?\s+|todo[:,]?\s+)?/i;
// Subjects in front of a status phrase ("we are working on …", "I'm blocked on …").
const SUBJECT_START = /^\s*(?:i am|i'm|im|we are|we're|were|i was|we were|currently|right now|at the moment)\s+(?=\S)/i;
const FILLER_END = /[\s,.]+(?:please|thanks|thank you|that's it|that is it|that's all|that is all|okay|ok|over)[\s.!]*$/i;
const EDGE_WORDS = ['and', 'with', 'it', 'its', "it's", 'is', 'as', 'status', 'priority', 'set', 'to', 'also', 'please', 'by', 'due', 'for', 'of', 'which', 'that', 'mark', 'marked', 'now', 'currently', 'hai', 'ko', 'should', 'be', 'the', 'a', 'an', 'task', 'on', 'in', 'are', 'am', 'was', 'were', 'we', 'i', "we're", "i'm", 'so', 'um', 'uh', 'okay', 'ok'];
const LEAD_EDGE = ['and', 'also', 'it', 'is', 'status', 'priority', 'then', 'so', 'to'];

// ---------- helpers ----------
const pad = (n: number) => (n < 10 ? '0' : '') + n;
export function iso(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function weekdayIndex(word: string): number {
  for (let i = 0; i < 7; i++) if (word === WEEKDAYS[i] || WD_SHORT[i].includes(word)) return i;
  return -1;
}
function monthIndex(word: string): number {
  for (let i = 0; i < 12; i++) if (word === MONTHS[i] || MON_SHORT[i].includes(word)) return i;
  return -1;
}
function futureDate(today: Date, month: number, day: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let d = new Date(today.getFullYear(), month, day);
  if (d < today) d = new Date(today.getFullYear() + 1, month, day);
  return iso(d);
}

/** Resolve a spoken date phrase to YYYY-MM-DD relative to `now`. */
export function resolveDate(phrase: string, now: Date = new Date()): string | null {
  const today = startOfDay(now);
  const s = phrase.toLowerCase()
    .replace(/^(?:due(?: by| on)?|by|before|until|till|deadline(?: is)?)\s+/, '')
    .replace(/\s+(?:tak|तक)$/, '')
    .replace(/^the\s+/, '')
    .trim();
  let m: RegExpMatchArray | null;
  if (/^(day after tomorrow|parso|परसों)$/.test(s)) return iso(addDays(today, 2));
  if (/^(end of (the )?day|eod|tonight|today|aaj|आज)$/.test(s)) return iso(today);
  if (/^(tomorrow|tmrw|tmr|kal|कल)$/.test(s)) return iso(addDays(today, 1));
  if (/^(end of (the )?week|eow)$/.test(s)) return iso(addDays(today, (5 - today.getDay() + 7) % 7));
  if (/^(this weekend|weekend)$/.test(s)) return iso(addDays(today, (6 - today.getDay() + 7) % 7));
  if (/^(end of (the )?month|eom)$/.test(s)) return iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  if (/^(next week|agle hafte|अगले हफ्ते)$/.test(s)) return iso(addDays(today, ((1 - today.getDay() + 7) % 7) || 7));
  if ((m = s.match(/^in (.+?) (days?|weeks?)$/))) {
    const key = m[1].replace(/^a (couple of|few)$/, '$1').replace(/ of$/, '');
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUMWORDS[key] || 1;
    return iso(addDays(today, m[2].charAt(0) === 'w' ? n * 7 : n));
  }
  if ((m = s.match(/^(next |this |coming )?([a-z]+)$/)) && weekdayIndex(m[2]) >= 0) {
    const wd = weekdayIndex(m[2]);
    let diff = (wd - today.getDay() + 7) % 7;
    if (m[1] && diff === 0) diff = 7; // "next friday" said on a Friday means a week out
    return iso(addDays(today, diff));
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)$/)) && monthIndex(m[2]) >= 0) {
    return futureDate(today, monthIndex(m[2]), parseInt(m[1], 10));
  }
  if ((m = s.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/)) && monthIndex(m[1]) >= 0) {
    return futureDate(today, monthIndex(m[1]), parseInt(m[2], 10));
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/))) {
    return futureDate(today, parseInt(m[2], 10) - 1, parseInt(m[1], 10)); // dd/mm
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?$/))) {
    const day = parseInt(m[1], 10);
    let d = new Date(today.getFullYear(), today.getMonth(), day);
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, day);
    return iso(d);
  }
  return null;
}

interface Hit { start: number; end: number; text: string; m: RegExpExecArray }

// Finds a regex match and returns the real start (after the boundary group).
function find(re: RegExp, s: string): Hit | null {
  const m = re.exec(s);
  if (!m) return null;
  const lead = m[1] || '';
  return { start: m.index + lead.length, end: m.index + m[0].length, text: m[2] !== undefined ? m[2] : m[0].slice(lead.length), m };
}
const cut = (s: string, hit: Hit) => s.slice(0, hit.start) + SEP + s.slice(hit.end);

// Index of the next keyword of any kind, used to end a spoken blocked reason.
function nextKeywordIndex(s: string): number {
  let best = s.length;
  const res = [P.lowPri, P.medPri, P.highPri, P.dueLead, P.dueBare, P.assign, P.project, P.voiceTag].concat(STATUS_RX.map((x) => x.re));
  for (const re of res) {
    const h = find(re, s);
    if (h && h.start < best) best = h.start;
  }
  const punct = s.search(/[,.;\u0001]/);
  if (punct >= 0 && punct < best) best = punct;
  return best;
}

const sepRe = new RegExp(SEP, 'g');
const onlyFillerBefore = (s: string, idx: number) => s.slice(0, idx).replace(sepRe, ' ').trim() === '';
const wordsAfter = (s: string, idx: number) => s.slice(idx).replace(sepRe, ' ').trim().split(/\s+/).filter(Boolean).length;

function matchTeam(name: string, team: string[]): string | null {
  const n = name.toLowerCase();
  for (const t of team) {
    if (t.toLowerCase() === n || t.toLowerCase().split(/\s+/)[0] === n) return t;
  }
  return null;
}

function cleanPiece(piece: string, isFirst: boolean): string {
  let p = piece.replace(/\s+/g, ' ').replace(/^[\s,.;:\-–]+|[\s,.;:\-–]+$/g, '');
  let changed = true;
  while (changed && p) {
    changed = false;
    const words = p.split(' ');
    const last = words[words.length - 1].toLowerCase().replace(/[,.;:]$/, '');
    if (words.length > 1 && EDGE_WORDS.includes(last)) { words.pop(); changed = true; }
    const first = words[0].toLowerCase().replace(/[,.;:]$/, '');
    if (words.length > 1 && LEAD_EDGE.includes(first) && !isFirst) { words.shift(); changed = true; }
    else if (words.length > 1 && ['and', 'also', 'status', 'priority', 'is'].includes(first)) { words.shift(); changed = true; }
    p = words.join(' ').replace(/^[\s,.;:\-–]+|[\s,.;:\-–]+$/g, '');
  }
  // A leftover fragment made only of filler ("… and we are" → "we") is not part of the title.
  if (!p.includes(' ') && EDGE_WORDS.includes(p.toLowerCase())) return '';
  return p;
}

/** Parse one task sentence. */
export function parseTask(text: string, opts: ParseOptions = {}): ParsedTask {
  const now = opts.now || new Date();
  const team = opts.team || [];
  const out: ParsedTask = { title: '', status: null, priority: null, due: null, assignee: null, tags: [], project: null, blockedReason: null, raw: text };
  let s = ' ' + String(text || '').replace(/\s+/g, ' ').trim().replace(FILLER_END, '') + ' ';
  let prev: string;
  do { prev = s; s = s.replace(FILLER_START, ' ').replace(SUBJECT_START, ' '); } while (s !== prev);
  const spoken = s.trim();
  let h: Hit | null;
  let guard = 0;

  // Tags: typed #tags and spoken "tag backend".
  while ((h = find(P.hashTag, s)) && guard++ < 10) { out.tags.push(h.m[2].toLowerCase()); s = cut(s, h); }
  guard = 0;
  while ((h = find(P.voiceTag, s)) && guard++ < 10) { out.tags.push(h.text.split(/\s+/).pop()!.toLowerCase()); s = cut(s, h); }

  // Assignee: "@priya" or "assign to Priya".
  if ((h = find(P.atMention, s))) {
    const at = h.m[2];
    out.assignee = matchTeam(at, team) || cap(at);
    s = cut(s, h);
  }
  if (!out.assignee && (h = find(P.assign, s))) {
    const words = h.text.split(/\s+/);
    const nameWords = words.slice(words.includes('to') ? words.lastIndexOf('to') + 1 : words.length - 1);
    const hitTwo = nameWords.length > 1 ? matchTeam(nameWords.join(' '), team) : null;
    const name = hitTwo || matchTeam(nameWords[0], team) || cap(nameWords[0]);
    if (!hitTwo && nameWords.length > 1) h.end -= nameWords[1].length + 1; // give the 2nd word back
    out.assignee = name;
    s = cut(s, h);
  }

  // Project: "for project Apollo".
  if ((h = find(P.project, s))) { out.project = cap(h.text.split(/\s+/).pop()!); s = cut(s, h); }

  // Blocked with a reason: "blocked by legal approval".
  h = find(BLOCKED_RX, s);
  if (h) {
    const rest = s.slice(h.end);
    const why = rest.match(P.blockedWhy);
    if (why) {
      const reasonText = rest.slice(why[0].length);
      const endIdx = nextKeywordIndex(' ' + reasonText) - 1;
      const reason = reasonText.slice(0, Math.max(0, endIdx)).trim();
      if (reason) {
        out.status = 2;
        out.blockedReason = cap(reason.replace(/[,.;:]+$/, ''));
        s = s.slice(0, h.start) + SEP + rest.slice(why[0].length + Math.max(0, endIdx));
      }
    }
  }

  // Priority (low first so "not urgent" does not read as urgent).
  if ((h = find(P.lowPri, s))) { out.priority = 'low'; s = cut(s, h); }
  else if ((h = find(P.medPri, s))) { out.priority = 'medium'; s = cut(s, h); }
  else if ((h = find(P.highPri, s))) { out.priority = 'high'; s = cut(s, h); }

  // Due date.
  if ((h = find(P.dueLead, s)) || (h = find(P.dueBare, s))) {
    const date = resolveDate(h.text, now);
    if (date) { out.due = date; s = cut(s, h); }
  }

  // Status words.
  if (out.status === null) {
    for (const { level, re } of STATUS_RX) {
      h = find(re, s);
      if (!h) continue;
      const single = !/\s/.test(h.text) && !/[^\x00-\x7f]/.test(h.text);
      // "Review PR from Rahul": a single status word at the start is a verb, keep it.
      if (single && onlyFillerBefore(s, h.start) && wordsAfter(s, h.end) >= 1) continue;
      out.status = level;
      if (/^(working on|currently doing)$/i.test(h.text)) {
        if (onlyFillerBefore(s, h.start)) {
          // "working on the app" → "Work on the app"; "working on checkout redesign" → "Checkout redesign".
          const rest = s.slice(h.end);
          const content = rest.replace(sepRe, ' ').trim().replace(/^(?:the|a|an|our|my|this)\s+/i, '').split(/\s+/).filter(Boolean);
          s = s.slice(0, h.start) + (content.length <= 1 ? ' Work on ' + rest.trimStart() : ' ' + rest.replace(/^\s*the\s+/i, ' '));
        }
        // Mid-sentence ("Priya is working on the design"): keep the words, only set the status.
      } else s = cut(s, h);
      break;
    }
  }

  const pieces = s.split(SEP).map((p, idx) => cleanPiece(p, idx === 0)).filter(Boolean);
  out.title = cap(pieces.join(' ').replace(/\s+/g, ' ').trim()).slice(0, 300);
  // Never drop a spoken sentence: if keywords used up every word, fall back to something readable.
  if (!out.title && out.blockedReason) out.title = cap(out.blockedReason.replace(/^(?:the|a|an)\s+/i, ''));
  else if (!out.title && spoken.split(/\s+/).length >= 2) out.title = cap(cleanPiece(spoken.replace(sepRe, ' '), true)).slice(0, 300);
  return out;
}

/** Split a transcript into task sentences and parse each. */
export function parseInput(text: string, opts?: ParseOptions): ParsedTask[] {
  return String(text || '')
    .split(P.split)
    .map((part) => parseTask(part, opts))
    .filter((t) => t.title.length > 0);
}

// ---------- commands on existing tasks ----------
const STOP = ['the', 'a', 'an', 'task', 'to', 'as', 'on', 'for', 'of', 'my', 'is', 'it', 'and', 'with', 'about', 'that', 'this'];
function tokens(s: string): string[] {
  return String(s || '').toLowerCase().replace(/[^\wऀ-ॿ\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.includes(w));
}
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) return a.startsWith(b) || b.startsWith(a);
  return false;
}
export function similarity(ref: string, title: string): number {
  const r = tokens(ref), t = tokens(title);
  if (!r.length || !t.length) return 0;
  let hit = 0;
  r.forEach((w) => { if (t.some((x) => sameWord(w, x))) hit++; });
  return (hit / r.length) * 0.7 + (hit / t.length) * 0.3;
}

const CMD = /^\s*(?:(?:ok(?:ay)?|hey|please)[,\s]+)*(mark|move|set|put|update|change|make|complete|finish|close|start|begin|resume|pause|stop)\s+(.+)$/i;

/**
 * Returns the command when the sentence clearly refers to an existing task,
 * otherwise null (the caller then creates a task).
 */
export function parseCommand(text: string, tasks: Array<{ id: string; title: string }>, opts?: ParseOptions): ParsedCommand | null {
  const m = String(text || '').match(CMD);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const p = parseTask(m[2], opts);
  let ref = p.title.replace(/^(?:task|the)\s+/i, '');
  const changes: CommandChanges = {};
  let timer: ParsedCommand['timer'] = null;
  if (p.status !== null) changes.status = p.status;
  if (p.priority) changes.priority = p.priority;
  if (p.due) changes.due = p.due;
  if (p.assignee) changes.assignee = p.assignee;
  if (p.blockedReason) changes.blockedReason = p.blockedReason;
  if (p.tags.length) changes.tags = p.tags;

  let strict = false;
  if (/^(complete|finish|close)$/.test(verb)) { changes.status = 4; strict = true; }
  else if (/^(start|begin|resume)$/.test(verb)) { changes.status = 1; timer = 'start'; strict = true; }
  else if (/^(pause|stop)$/.test(verb)) { timer = 'pause'; strict = true; ref = ref.replace(/^(?:the\s+)?(?:timer|focus)(?:\s+(?:on|for))?\s*/i, ''); }
  else if (!Object.keys(changes).length) return null;

  if (timer === 'pause' && !ref) return { taskId: null, changes: {}, timer: 'pause', verb, score: 1 };

  let best: { id: string; title: string } | null = null;
  let score = 0;
  for (const t of tasks || []) {
    const sc = similarity(ref, t.title);
    if (sc > score) { score = sc; best = t; }
  }
  const need = strict ? 0.75 : 0.5;
  if (!best || score < need) return null;
  return { taskId: best.id, title: best.title, changes, timer, verb, score };
}
