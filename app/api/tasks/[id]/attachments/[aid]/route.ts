import { z } from 'zod';
import { db } from '@/lib/server/db';
import { HttpError, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { activityQuery, getTask } from '@/lib/server/tasks';
import { canManageTask } from '@/lib/access';

type Ctx = { params: Promise<{ id: string; aid: string }> };

// Only raster images are shown in the browser. Everything else (PDF, SVG, HTML, …) downloads,
// so an uploaded file can never run script on our origin.
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export const GET = route(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id, aid } = await ctx.params;
  if (!z.uuid().safeParse(aid).success) throw new HttpError(404, 'File not found');
  await getTask(u, id);
  const rows = await db()`
    SELECT name, mime, encode(data, 'base64') AS b64 FROM attachments
    WHERE id = ${aid} AND task_id = ${id} AND org_id = ${u.orgId}`;
  const f = rows[0];
  if (!f) throw new HttpError(404, 'File not found');

  const mime = String(f.mime);
  const inline = INLINE.has(mime) && !new URL(req.url).searchParams.has('download');
  const name = String(f.name);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(Buffer.from(String(f.b64), 'base64'), {
    headers: {
      'Content-Type': inline ? mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=3600'
    }
  });
});

// The uploader, or anyone who could delete the task, can remove a file.
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id, aid } = await ctx.params;
  if (!z.uuid().safeParse(aid).success) throw new HttpError(404, 'File not found');
  const task = await getTask(u, id);
  const sql = db();
  const rows = await sql`SELECT name, uploader_id FROM attachments WHERE id = ${aid} AND task_id = ${id} AND org_id = ${u.orgId}`;
  const f = rows[0];
  if (!f) throw new HttpError(404, 'File not found');
  if (f.uploader_id !== u.id && !canManageTask(u, task)) throw new HttpError(403, 'Only the uploader, the task owner, a team lead or an admin can remove this file');
  await sql.transaction([
    sql`DELETE FROM attachments WHERE id = ${aid}`,
    activityQuery(id, u.id, [`Removed “${String(f.name)}”`]),
    sql`UPDATE tasks SET updated_at = now() WHERE id = ${id}`
  ]);
  return json({ ok: true });
});
