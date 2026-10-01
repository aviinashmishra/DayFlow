import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { getTask, mapAttachment } from '@/lib/server/tasks';
import { ATTACH_MAX_BYTES, ATTACH_MAX_PER_TASK } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

// Files arrive as base64 inside JSON so uploads keep the same-origin JSON guard used by every write.
const schema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().max(120).default(''),
  data: z.string().max(Math.ceil(ATTACH_MAX_BYTES / 3) * 4 + 4).regex(/^[A-Za-z0-9+/]*={0,2}$/, 'File data must be base64')
});

// Keep names printable and path-free; they end up in a Content-Disposition header.
const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 200) || 'file';
const cleanMime = (s: string) => (/^[\w.+-]+\/[\w.+-]+$/.test(s) ? s.toLowerCase() : 'application/octet-stream');

export const POST = route(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const input = await body(req, schema);
  await getTask(u, id);

  const size = Buffer.from(input.data, 'base64').length;
  if (size > ATTACH_MAX_BYTES) throw new HttpError(413, `Files can be up to ${ATTACH_MAX_BYTES / 1024 / 1024} MB`);
  const name = cleanName(input.name);

  // The count check lives in the INSERT so parallel uploads cannot pass the limit, and the
  // history line and timestamp are only written when a file was actually stored.
  const rows = await db()`
    WITH ins AS (
      INSERT INTO attachments (task_id, org_id, uploader_id, name, mime, size, data)
      SELECT ${id}, ${u.orgId}, ${u.id}, ${name}, ${cleanMime(input.type)}, ${size}, decode(${input.data}, 'base64')
      WHERE (SELECT count(*) FROM attachments WHERE task_id = ${id}) < ${ATTACH_MAX_PER_TASK}
      RETURNING id, task_id, name, mime, size, uploader_id, created_at
    ), act AS (
      INSERT INTO activity (task_id, actor_id, change) SELECT task_id, uploader_id, ${`Attached “${name}”`} FROM ins
    ), touch AS (
      UPDATE tasks SET updated_at = now() WHERE id IN (SELECT task_id FROM ins)
    )
    SELECT * FROM ins`;
  if (!rows[0]) throw new HttpError(400, `A task can hold up to ${ATTACH_MAX_PER_TASK} files`);
  return json({ attachment: mapAttachment({ ...rows[0], uploader_name: u.name }) }, 201);
});
