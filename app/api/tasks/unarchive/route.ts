import { db } from '@/lib/server/db';
import { body, json, route } from '@/lib/server/http';
import { isAdmin, ledTeams, requireUser } from '@/lib/server/auth';
import { idList } from '@/lib/server/tasks';

// Undo "clear done". Same people who may clear may bring back.
export const POST = route(async (req) => {
  const u = await requireUser();
  const { ids } = await body(req, idList);
  const rows = await db()`
    UPDATE tasks SET archived_at = NULL, updated_at = now()
    WHERE org_id = ${u.orgId} AND id = ANY(${ids}::uuid[]) AND archived_at IS NOT NULL AND deleted_at IS NULL AND (NOT private OR creator_id = ${u.id})
      AND (${isAdmin(u)} OR assignee_id = ${u.id} OR (assignee_id IS NULL AND creator_id = ${u.id}) OR team_id = ANY(${ledTeams(u)}::uuid[]))
    RETURNING id`;
  return json({ ids: rows.map((r) => String(r.id)) });
});
