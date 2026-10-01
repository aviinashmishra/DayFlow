/*
 * Dayflow natural-language parser.
 * Turns a typed line or a voice transcript into one or more tasks, or into a
 * command that updates an existing task ("mark checkout bug as done").
 * Plain ES5 so it runs in every target browser and in Node for tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DayflowParser = api;
})(this, function () {
  'use strict';

  var SEP = '\u0001';
  // Word boundaries that also work for Devanagari (\b does not).
  var PRE = '(^|[\\s,.;:!?()\\u0001])';
  var POST = '(?=$|[\\s,.;:!?()\\u0001])';

  function rx(src, flags) { return new RegExp(PRE + '(' + src + ')' + POST, flags || 'i'); }

  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var WD_SHORT = [['sun'], ['mon'], ['tue', 'tues'], ['wed'], ['thu', 'thur', 'thurs'], ['fri'], ['sat']];
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var MON_SHORT = [['jan'], ['feb'], ['mar'], ['apr'], ['may'], ['jun'], ['jul'], ['aug'], ['sep', 'sept'], ['oct'], ['nov'], ['dec']];
  var NUMWORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, couple: 2, few: 3 };

  var WD_FULL = WEEKDAYS.join('|');
  var WD_ANY = WEEKDAYS.map(function (d, i) { return d + '|' + WD_SHORT[i].join('|'); }).join('|');
  var MON_ANY = MONTHS.map(function (m, i) { return m + '|' + MON_SHORT[i].join('|'); }).join('|');
  var ORD = '(?:st|nd|rd|th)?';
  var NUMW = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an|a couple of|a few)';

  // Date phrases that are safe on their own ("call vendor tomorrow").
  var DATE_BARE =
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
  var DATE_LEAD = DATE_BARE + '|(?:next |this |coming )?(?:' + WD_ANY + ')|(?:the )?\\d{1,2}' + ORD + '|\\d{1,2}/\\d{1,2}';

  var P = {
    split: /(?:^|[\s,.;:!?])(?:next task|new task|another task|next one|agla task|अगला टास्क|अगला काम)(?=$|[\s,.;:!?])|[\n;]+/gi,
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

  var STATUS_PHRASES = [
    // Multi-word phrases first so "in review" wins over "review".
    [3, 'ready for review|needs review|needs a review|send for review|sent for review|awaiting review|in review|for review|under review'],
    [1, 'work in progress|in progress|working on|currently doing|chal raha hai|chal raha|चल रहा है|चल रहा|wip|started|ongoing'],
    [2, 'on hold|atka hua hai|atka hua|atka|ruka hua|अटका हुआ|अटका|रुका हुआ|blocked|stuck|waiting'],
    [4, 'ho gaya hai|ho gaya|ho gya|पूरा हो गया|हो गया|khatam|खत्म|done|finished|completed|complete'],
    [0, 'todo|backlog|queued|baad mein|बाद में|later'],
    [3, 'review']
  ];
  var STATUS_RX = STATUS_PHRASES.map(function (p) { return { level: p[0], re: rx(p[1]) }; });

  var FILLER_START = /^\s*(?:(?:ok(?:ay)?|hey|so|um+|uh+|and|also|then)[,\s]+)*(?:please\s+)?(?:(?:add|create|new|make)(?:\s+a)?(?:\s+new)?\s+task(?:\s+(?:to|called|named))?[:,]?\s+|remind me to\s+|i (?:need|have|want) to\s+|i've got to\s+|i gotta\s+|task[:,]?\s+|todo[:,]?\s+)/i;
  var EDGE_WORDS = ['and', 'with', 'it', 'its', "it's", 'is', 'as', 'status', 'priority', 'set', 'to', 'also', 'please', 'by', 'due', 'for', 'of', 'which', 'that', 'mark', 'marked', 'now', 'currently', 'hai', 'ko', 'should', 'be', 'the', 'a', 'an', 'task', 'on', 'in'];
  var LEAD_EDGE = ['and', 'also', 'it', 'is', 'status', 'priority', 'then', 'so', 'to'];

  // ---------- helpers ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function weekdayIndex(word) {
    for (var i = 0; i < 7; i++) {
      if (word === WEEKDAYS[i] || WD_SHORT[i].indexOf(word) >= 0) return i;
    }
    return -1;
  }
  function monthIndex(word) {
    for (var i = 0; i < 12; i++) {
      if (word === MONTHS[i] || MON_SHORT[i].indexOf(word) >= 0) return i;
    }
    return -1;
  }

  /** Resolve a spoken date phrase to YYYY-MM-DD relative to `now`. */
  function resolveDate(phrase, now) {
    var today = startOfDay(now || new Date());
    var s = phrase.toLowerCase()
      .replace(/^(?:due(?: by| on)?|by|before|until|till|deadline(?: is)?)\s+/, '')
      .replace(/\s+(?:tak|तक)$/, '')
      .replace(/^the\s+/, '')
      .trim();
    var m;
    if (/^(day after tomorrow|parso|परसों)$/.test(s)) return iso(addDays(today, 2));
    if (/^(end of (the )?day|eod|tonight|today|aaj|आज)$/.test(s)) return iso(today);
    if (/^(tomorrow|tmrw|tmr|kal|कल)$/.test(s)) return iso(addDays(today, 1));
    if (/^(end of (the )?week|eow)$/.test(s)) return iso(addDays(today, (5 - today.getDay() + 7) % 7));
    if (/^(this weekend|weekend)$/.test(s)) return iso(addDays(today, (6 - today.getDay() + 7) % 7));
    if (/^(end of (the )?month|eom)$/.test(s)) return iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    if (/^(next week|agle hafte|अगले हफ्ते)$/.test(s)) return iso(addDays(today, ((1 - today.getDay() + 7) % 7) || 7));
    if ((m = s.match(/^in (.+?) (days?|weeks?)$/))) {
      var n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUMWORDS[m[1].replace(/^a (couple of|few)$/, '$1')] || 1;
      return iso(addDays(today, m[2].charAt(0) === 'w' ? n * 7 : n));
    }
    if ((m = s.match(/^(next |this |coming )?([a-z]+)$/)) && weekdayIndex(m[2]) >= 0) {
      var wd = weekdayIndex(m[2]);
      var diff = (wd - today.getDay() + 7) % 7;
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
      var day = parseInt(m[1], 10);
      var d = new Date(today.getFullYear(), today.getMonth(), day);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, day);
      return iso(d);
    }
    return null;
  }

  function futureDate(today, month, day) {
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    var d = new Date(today.getFullYear(), month, day);
    if (d < today) d = new Date(today.getFullYear() + 1, month, day);
    return iso(d);
  }

  // Finds a regex match and returns the real start (after the boundary group).
  function find(re, s) {
    var m = re.exec(s);
    if (!m) return null;
    var lead = m[1] || '';
    return { start: m.index + lead.length, end: m.index + m[0].length, text: m[2] !== undefined ? m[2] : m[0].slice(lead.length), m: m };
  }
  function cut(s, hit) { return s.slice(0, hit.start) + SEP + s.slice(hit.end); }

  // Index of the next keyword of any kind, used to end a spoken blocked reason.
  function nextKeywordIndex(s) {
    var best = s.length;
    var res = [P.lowPri, P.medPri, P.highPri, P.dueLead, P.dueBare, P.assign, P.project, P.voiceTag].concat(STATUS_RX.map(function (x) { return x.re; }));
    for (var i = 0; i < res.length; i++) {
      var h = find(res[i], s);
      if (h && h.start < best) best = h.start;
    }
    var punct = s.search(/[,.;\u0001]/);
    if (punct >= 0 && punct < best) best = punct;
    return best;
  }

  function onlyFillerBefore(s, idx) {
    return s.slice(0, idx).replace(new RegExp(SEP, 'g'), ' ').trim() === '';
  }
  function wordsAfter(s, idx) {
    return s.slice(idx).replace(new RegExp(SEP, 'g'), ' ').trim().split(/\s+/).filter(Boolean).length;
  }

  function matchTeam(name, team) {
    var n = name.toLowerCase();
    for (var i = 0; i < (team || []).length; i++) {
      var t = team[i];
      if (t.toLowerCase() === n || t.toLowerCase().split(/\s+/)[0] === n) return t;
    }
    return null;
  }

  function cleanPiece(piece, isFirst) {
    var p = piece.replace(/\s+/g, ' ').replace(/^[\s,.;:\-–]+|[\s,.;:\-–]+$/g, '');
    var changed = true;
    while (changed && p) {
      changed = false;
      var words = p.split(' ');
      var last = words[words.length - 1].toLowerCase().replace(/[,.;:]$/, '');
      if (words.length > 1 && EDGE_WORDS.indexOf(last) >= 0) { words.pop(); changed = true; }
      var first = words[0].toLowerCase().replace(/[,.;:]$/, '');
      if (words.length > 1 && LEAD_EDGE.indexOf(first) >= 0 && !isFirst) { words.shift(); changed = true; }
      else if (words.length > 1 && ['and', 'also', 'status', 'priority', 'is'].indexOf(first) >= 0) { words.shift(); changed = true; }
      p = words.join(' ').replace(/^[\s,.;:\-–]+|[\s,.;:\-–]+$/g, '');
    }
    return p;
  }

  /** Parse one task sentence. */
  function parseTask(text, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var team = opts.team || [];
    var out = { title: '', status: null, priority: null, due: null, assignee: null, tags: [], project: null, blockedReason: null, raw: text };
    var s = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
    var prev;
    do { prev = s; s = s.replace(FILLER_START, ' '); } while (s !== prev);
    var h, guard;

    // Tags: typed #tags and spoken "tag backend".
    guard = 0;
    while ((h = find(P.hashTag, s)) && guard++ < 10) { out.tags.push(h.m[2].toLowerCase()); s = cut(s, h); }
    guard = 0;
    while ((h = find(P.voiceTag, s)) && guard++ < 10) { out.tags.push(h.text.split(/\s+/).pop().toLowerCase()); s = cut(s, h); }

    // Assignee: "@priya" or "assign to Priya".
    if ((h = find(P.atMention, s))) {
      var at = h.m[2];
      out.assignee = matchTeam(at, team) || cap(at);
      s = cut(s, h);
    }
    if (!out.assignee && (h = find(P.assign, s))) {
      var words = h.text.split(/\s+/);
      var nameWords = words.slice(words.indexOf('to') >= 0 ? words.lastIndexOf('to') + 1 : words.length - 1);
      var two = nameWords.join(' ');
      var one = nameWords[0];
      var hitTwo = nameWords.length > 1 && matchTeam(two, team);
      var name = hitTwo || matchTeam(one, team) || cap(one);
      if (!hitTwo && nameWords.length > 1) h.end -= (nameWords[1].length + 1); // give the 2nd word back
      out.assignee = name;
      s = cut(s, h);
    }

    // Project: "for project Apollo".
    if ((h = find(P.project, s))) { out.project = cap(h.text.split(/\s+/).pop()); s = cut(s, h); }

    // Blocked with a reason: "blocked by legal approval".
    var blockedRe = rx('on hold|atka hua hai|atka hua|atka|ruka hua|अटका हुआ|अटका|रुका हुआ|blocked|stuck|waiting');
    h = find(blockedRe, s);
    if (h) {
      var rest = s.slice(h.end);
      var why = rest.match(P.blockedWhy);
      if (why) {
        var reasonText = rest.slice(why[0].length);
        var endIdx = nextKeywordIndex(' ' + reasonText) - 1;
        var reason = reasonText.slice(0, Math.max(0, endIdx)).trim();
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
      var date = resolveDate(h.text, now);
      if (date) { out.due = date; s = cut(s, h); }
    }

    // Status words.
    if (out.status === null) {
      for (var i = 0; i < STATUS_RX.length; i++) {
        h = find(STATUS_RX[i].re, s);
        if (!h) continue;
        var single = !/\s/.test(h.text) && !/[^\x00-\x7f]/.test(h.text);
        // "Review PR from Rahul": a single status word at the start is a verb, keep it.
        if (single && onlyFillerBefore(s, h.start) && wordsAfter(s, h.end) >= 1) continue;
        out.status = STATUS_RX[i].level;
        if (/^working on$/i.test(h.text) || /^currently doing$/i.test(h.text)) s = s.slice(0, h.start) + ' ' + s.slice(h.end);
        else s = cut(s, h);
        break;
      }
    }

    var pieces = s.split(SEP).map(function (p, idx) { return cleanPiece(p, idx === 0); }).filter(Boolean);
    out.title = cap(pieces.join(' ').replace(/\s+/g, ' ').trim());
    return out;
  }

  /** Split a transcript into task sentences and parse each. */
  function parseInput(text, opts) {
    return String(text || '')
      .split(P.split)
      .map(function (part) { return parseTask(part, opts); })
      .filter(function (t) { return t.title.length > 0; });
  }

  // ---------- commands on existing tasks ----------
  var STOP = ['the', 'a', 'an', 'task', 'to', 'as', 'on', 'for', 'of', 'my', 'is', 'it', 'and', 'with', 'about', 'that', 'this'];
  function tokens(s) {
    return String(s || '').toLowerCase().replace(/[^\wऀ-ॿ\s]/g, ' ').split(/\s+/).filter(function (w) { return w && STOP.indexOf(w) < 0; });
  }
  function sameWord(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4) return a.indexOf(b) === 0 || b.indexOf(a) === 0;
    return false;
  }
  function similarity(ref, title) {
    var r = tokens(ref), t = tokens(title);
    if (!r.length || !t.length) return 0;
    var hit = 0;
    r.forEach(function (w) { if (t.some(function (x) { return sameWord(w, x); })) hit++; });
    return (hit / r.length) * 0.7 + (hit / t.length) * 0.3;
  }

  function bestMatch(ref, tasks) {
    var best = null, score = 0;
    (tasks || []).forEach(function (t) {
      var sc = similarity(ref, t.title);
      if (sc > score) { score = sc; best = t; }
    });
    return best ? { task: best, score: score } : null;
  }

  var CMD = /^\s*(?:(?:ok(?:ay)?|hey|please)[,\s]+)*(mark|move|set|put|update|change|make|complete|finish|close|start|begin|resume|pause|stop)\s+(.+)$/i;

  /**
   * Returns {taskId, changes, timer, verb, score} when the sentence clearly
   * refers to an existing task, otherwise null (caller then creates a task).
   */
  function parseCommand(text, tasks, opts) {
    var m = String(text || '').match(CMD);
    if (!m) return null;
    var verb = m[1].toLowerCase();
    var p = parseTask(m[2], opts);
    var ref = p.title.replace(/^(?:task|the)\s+/i, '');
    var changes = {};
    var timer = null;
    if (p.status !== null) changes.status = p.status;
    if (p.priority) changes.priority = p.priority;
    if (p.due) changes.due = p.due;
    if (p.assignee) changes.assignee = p.assignee;
    if (p.blockedReason) changes.blockedReason = p.blockedReason;
    if (p.tags.length) changes.tags = p.tags;

    var strict = false;
    if (/^(complete|finish|close)$/.test(verb)) { changes.status = 4; strict = true; }
    else if (/^(start|begin|resume)$/.test(verb)) { changes.status = 1; timer = 'start'; strict = true; }
    else if (/^(pause|stop)$/.test(verb)) { timer = 'pause'; strict = true; ref = ref.replace(/^(?:the\s+)?(?:timer|focus)(?:\s+(?:on|for))?\s*/i, ''); }
    else if (!Object.keys(changes).length) return null;

    var candidates = (tasks || []).filter(function (t) { return !t.archived; });
    if (timer === 'pause' && !ref) {
      return { taskId: null, changes: {}, timer: 'pause', verb: verb, score: 1 };
    }
    var hit = bestMatch(ref, candidates);
    var need = strict ? 0.75 : 0.5;
    if (!hit || hit.score < need) return null;
    return { taskId: hit.task.id, title: hit.task.title, changes: changes, timer: timer, verb: verb, score: hit.score };
  }

  return {
    parseInput: parseInput,
    parseTask: parseTask,
    parseCommand: parseCommand,
    resolveDate: resolveDate,
    similarity: similarity,
    iso: iso
  };
});
