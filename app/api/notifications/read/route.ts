import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';

// Mark some notifications (or all of them, when no ids are given) as read.
const schema = z.object({ ids: z.array(z.string().regex(/^\d+$/)).max(200).optional() });

export const POST = route(async (req) => {
  const u = await requireUser();
  const { ids } = await body(req, schema);
  const rows = ids?.length
    ? await db()`UPDATE notifications SET read_at = now() WHERE user_id = ${u.id} AND read_at IS NULL AND id = ANY(${ids}::bigint[]) RETURNING id`
    : await db()`UPDATE notifications SET read_at = now() WHERE user_id = ${u.id} AND read_at IS NULL RETURNING id`;
  return json({ marked: rows.length });
});
