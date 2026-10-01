import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, json, route } from '@/lib/server/http';
import { loadUser, requireUser, toMe } from '@/lib/server/auth';

const settings = z
  .object({
    lang: z.enum(['en-IN', 'hi-IN', 'en-US', 'en-GB']),
    theme: z.enum(['auto', 'dark', 'light']),
    effects3d: z.boolean(),
    weightByPriority: z.boolean(),
    requireBlockedReason: z.boolean(),
    shareFocusInStandup: z.boolean(),
    pomodoro: z.union([z.literal(0), z.literal(15), z.literal(25), z.literal(45), z.literal(50)]),
    standupFormat: z.enum(['status', 'ytb', 'slack']),
    haptics: z.boolean(),
    wakeWord: z.boolean()
  })
  .partial()
  .strict();

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  // Job title shown in the people directory. Empty clears it.
  title: z.string().trim().max(80).optional(),
  settings: settings.optional()
});

export const PATCH = route(async (req) => {
  const u = await requireUser();
  const input = await body(req, schema);
  await db()`
    UPDATE users SET
      name = coalesce(${input.name ?? null}, name),
      title = CASE WHEN ${input.title !== undefined} THEN nullif(${input.title ?? ''}, '') ELSE title END,
      settings = settings || ${JSON.stringify(input.settings ?? {})}::jsonb
    WHERE id = ${u.id}`;
  return json({ me: toMe((await loadUser(u.id))!) });
});
