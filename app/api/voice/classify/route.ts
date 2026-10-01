import { z } from 'zod';
import { body, HttpError, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { classifyStory } from '@/lib/server/gemini';
import type { Status } from '@/lib/types';

// Two Gemini attempts of up to 10 s each (main model, then the lighter fallback).
export const maxDuration = 25;

const schema = z.object({
  text: z.string().trim().min(1).max(4000),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekday: z.string().trim().min(1).max(20),
  // Teammate names help Gemini spot hand-offs. The client matches them to real people afterwards.
  team: z.array(z.string().trim().min(1).max(80)).max(300).default([]),
  // The speaker's open tasks, so "I finished the login fix" moves that card instead of adding a copy.
  open: z.array(z.object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(300),
    status: z.number().int().min(0).max(4).transform((n) => n as Status)
  })).max(80).default([])
});

// A small per-instance brake so one open tab cannot run up the Gemini bill.
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 12;
const recent = new Map<string, number[]>();
function throttle(userId: string) {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) throw new HttpError(429, 'Too many voice stories in a minute. Wait a moment and try again.');
  hits.push(now);
  recent.set(userId, hits);
}

// Voice "story" → separate tasks with a status each. Nothing is saved here; the client adds the tasks.
export const POST = route(async (req) => {
  const u = await requireUser();
  const input = await body(req, schema);
  throttle(u.id);
  const tasks = await classifyStory(input);
  return json({ tasks });
});
