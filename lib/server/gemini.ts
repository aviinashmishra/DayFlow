import 'server-only';
import { z } from 'zod';
import { HttpError } from './http';
import type { Status } from '../types';
import type { StoryTask } from '../voice';

/*
 * Turns a spoken "story" ("this morning I fixed the login bug, now I'm on the
 * invoice, and tomorrow I have to call the vendor…") into separate tasks with a
 * status each, using Gemini's JSON mode. Only the transcript text is sent.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// The alias always points at Google's current Flash model. Pin one with GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-flash-latest';
// Tried once when the main model is overloaded or rate limited.
const FALLBACK_MODEL = 'gemini-flash-lite-latest';
const TIMEOUT_MS = 10000;

const STATUS_KEYS = ['queued', 'in_progress', 'blocked', 'review', 'done'] as const;

export interface StoryInput {
  text: string;
  today: string; // YYYY-MM-DD in the speaker's time zone
  weekday: string;
  team: string[];
}

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// Gemini's responseSchema is an OpenAPI subset; it keeps the reply machine-readable.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          status: { type: 'STRING', enum: [...STATUS_KEYS] },
          priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          due: { type: 'STRING', nullable: true },
          assignee: { type: 'STRING', nullable: true },
          tags: { type: 'ARRAY', items: { type: 'STRING' } },
          blockedReason: { type: 'STRING', nullable: true }
        },
        required: ['title', 'status', 'priority']
      }
    }
  },
  required: ['tasks']
};

const reply = z.object({
  tasks: z.array(z.object({
    title: z.string(),
    status: z.enum(STATUS_KEYS),
    priority: z.enum(['high', 'medium', 'low']).catch('medium'),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().catch(null),
    assignee: z.string().nullish().catch(null),
    tags: z.array(z.string()).nullish().catch(null),
    blockedReason: z.string().nullish().catch(null)
  })).max(40)
});

function instructions(input: StoryInput): string {
  const team = input.team.length ? input.team.join(', ') : '(none)';
  return `You turn a person's spoken work update into a clean task list for a task board.
Today is ${input.weekday}, ${input.today}. Teammates: ${team}.

Rules:
- Find every distinct piece of work the speaker has done, is doing, or plans to do. Split lists ("I emailed Priya and updated the deck") into separate tasks. Merge repeats of the same work into one task.
- Ignore small talk, feelings, fillers and anything that is not work.
- title: short and specific, starting with a verb, at most 80 characters ("Fix login crash on Android"). Keep the speaker's language (English, Hindi or Hinglish), but never add a time or status word to the title.
- status:
  done = finished or past tense ("fixed", "sent", "ho gaya", "kar diya");
  in_progress = happening now ("working on", "currently", "kar raha hoon");
  blocked = stuck or waiting on someone or something ("stuck on", "waiting for", "can't until");
  review = handed over for review or approval;
  queued = planned, future, or a to-do ("need to", "will", "tomorrow", "karna hai").
- blockedReason: only for blocked tasks, a few words on what it waits for.
- priority: high only when the speaker says urgent, ASAP, critical or similar; low when they say it can wait; otherwise medium.
- due: YYYY-MM-DD when a day is mentioned or clearly implied ("tomorrow", "by Friday", "kal"), worked out from today's date; otherwise null. Leave it null for done tasks.
- assignee: a teammate's name from the list, only when the work is handed to them ("ask Priya to…", "Rahul will…"); otherwise null.
- tags: at most 3 short lowercase topic words, only when obvious. Otherwise an empty list.
- If there is no work at all, return an empty list.`;
}

export async function classifyStory(input: StoryInput): Promise<StoryTask[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, 'Story mode is not set up. Add GEMINI_API_KEY to the server environment.');
  const models = [...new Set([process.env.GEMINI_MODEL || DEFAULT_MODEL, FALLBACK_MODEL])];
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: instructions(input) }] },
    contents: [{ role: 'user', parts: [{ text: input.text }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }
  });

  let res: Response | null = null;
  for (const model of models) {
    try {
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store'
      });
    } catch (err) {
      console.error(`Gemini request failed (${model})`, err);
      res = null;
      continue;
    }
    if (res.ok) break;
    console.error(`Gemini error (${model})`, res.status, (await res.text().catch(() => '')).slice(0, 500));
    // Busy or rate limited: the lighter model usually still has room. Anything else will not improve.
    if (res.status !== 429 && res.status < 500) break;
  }
  if (!res) throw new HttpError(502, 'Could not reach Gemini. Your words were kept in the box. Press Enter to add them.');
  if (!res.ok) {
    throw new HttpError(502, res.status === 429 || res.status === 503 ? 'Gemini is busy right now. Try again in a minute, or press Enter to add it as typed.' : 'Gemini could not sort that one. Press Enter to add it as typed.');
  }

  const data = (await res.json().catch(() => null)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null;
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let parsed: z.infer<typeof reply>;
  try {
    parsed = reply.parse(JSON.parse(text));
  } catch {
    console.error('Gemini returned unexpected output', text.slice(0, 500));
    throw new HttpError(502, 'Gemini gave an answer Dayflow could not read. Press Enter to add it as typed.');
  }

  const seen = new Set<string>();
  const out: StoryTask[] = [];
  for (const t of parsed.tasks) {
    const title = t.title.replace(/\s+/g, ' ').trim().slice(0, 300);
    const k = title.toLowerCase();
    if (!title || seen.has(k)) continue;
    seen.add(k);
    const status = STATUS_KEYS.indexOf(t.status) as Status;
    // Only teammates Dayflow knows can be assigned; anything else stays unassigned.
    const assignee = t.assignee && input.team.find((n) => n.toLowerCase() === t.assignee!.trim().toLowerCase()) || null;
    out.push({
      title,
      status,
      priority: t.priority,
      due: status === 4 ? null : t.due ?? null,
      assignee,
      tags: [...new Set((t.tags ?? []).map((x) => x.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '')).filter(Boolean))].slice(0, 3),
      blockedReason: status === 2 ? t.blockedReason?.trim().slice(0, 300) || null : null
    });
  }
  return out;
}
