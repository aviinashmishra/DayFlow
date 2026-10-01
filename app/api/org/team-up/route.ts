import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { mapTeam, teamFields } from '@/lib/server/org';

const schema = z.object({
  orgName: z.string().trim().min(1, 'Name your workspace').max(80),
  team: teamFields,
  // Private tasks to bring into the new team. Everything else stays private.
  taskIds: z.array(z.uuid()).max(500).default([])
});

// Turns a personal space into a team workspace: renames it, creates the first team
// (you lead it), shares the chosen tasks with that team, and turns on the invite link.
// One statement, so it either all happens or none of it does.
export const POST = route(async (req) => {
  const u = await requireUser();
  if (u.role !== 'owner') throw new HttpError(403, 'Only the owner can turn this space into a team workspace');
  const input = await body(req, schema);
  const { name, description = null, color = '#4f6cff' } = input.team;
  const rows = await db()`
    WITH o AS (
      UPDATE organizations SET kind = 'team', name = ${input.orgName}
      WHERE id = ${u.orgId} AND kind = 'personal' RETURNING id, invite_code
    ), t AS (
      INSERT INTO teams (org_id, name, description, color) SELECT o.id, ${name}, ${description}, ${color} FROM o
      RETURNING id, name, description, color
    ), m AS (
      INSERT INTO team_members (team_id, user_id, role) SELECT t.id, ${u.id}, 'lead' FROM t
    ), k AS (
      UPDATE tasks SET team_id = t.id, private = false, updated_at = now() FROM t
      WHERE tasks.org_id = ${u.orgId} AND tasks.creator_id = ${u.id} AND tasks.id = ANY(${input.taskIds}::uuid[]) AND tasks.deleted_at IS NULL
      RETURNING tasks.id
    ), act AS (
      INSERT INTO activity (task_id, actor_id, change) SELECT k.id, ${u.id}, ${`Shared with the ${name} team`} FROM k
    ), a AS (
      INSERT INTO audit_log (org_id, actor_id, action, detail)
      SELECT o.id, ${u.id}, 'org.upgraded', ${`Turned the personal space into ${input.orgName} with the ${name} team`} FROM o
    )
    SELECT t.id, t.name, t.description, t.color, (SELECT invite_code FROM o) AS invite_code, (SELECT count(*) FROM k)::int AS moved FROM t`;
  if (!rows[0]) throw new HttpError(409, 'This workspace already has teams. Add more from Organization → Teams.');
  return json({ team: mapTeam(rows[0]), inviteCode: String(rows[0].invite_code), moved: Number(rows[0].moved) || 0 }, 201);
});
