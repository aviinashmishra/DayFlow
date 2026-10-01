import { z } from 'zod';
import { db } from '@/lib/server/db';
import { HttpError, json, route } from '@/lib/server/http';
import { isAdmin, ledTeams, requireUser } from '@/lib/server/auth';
import { activityQuery, mapTask } from '@/lib/server/tasks';

type Ctx = { params: Promise<{ id: string }> };

// Undo a delete. Same people who may delete may restore.
export const POST = route(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, 'Task not found');
  const rows = await db()`
    UPDATE tasks SET deleted_at = NULL, updated_at = now()
    WHERE id = ${id} AND org_id = ${u.orgId} AND deleted_at IS NOT NULL AND (NOT private OR creator_id = ${u.id})
      AND (${isAdmin(u)} OR creator_id = ${u.id} OR assignee_id = ${u.id} OR team_id = ANY(${ledTeams(u)}::uuid[]))
    RETURNING id`;
  if (!rows[0]) throw new HttpError(404, 'Nothing to restore');
  const sql = db();
  const [, t] = await sql.transaction([activityQuery(id, u.id, ['Restored']), sql`SELECT * FROM task_view WHERE id = ${id}`]);
  return json({ task: mapTask(t[0]) });
});
