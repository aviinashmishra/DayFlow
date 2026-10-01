import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { isAdmin, requireUser } from '@/lib/server/auth';
import { auditQuery, mapTeam, teamFields } from '@/lib/server/org';

// Create a team (admins). The creator can add people afterwards.
export const POST = route(async (req) => {
  const u = await requireUser();
  if (!isAdmin(u)) throw new HttpError(403, 'Only admins can create teams');
  if (u.orgKind === 'personal') throw new HttpError(409, 'Create your first team with “Create a team”, which also sets up your workspace');
  const input = await body(req, teamFields);
  const sql = db();
  try {
    const [rows] = await sql.transaction([
      sql`INSERT INTO teams (org_id, name, description, color)
          VALUES (${u.orgId}, ${input.name}, ${input.description ?? null}, ${input.color ?? '#4f6cff'})
          RETURNING id, name, description, color`,
      auditQuery(u.orgId, u.id, 'team.created', `Created the ${input.name} team`)
    ]);
    return json({ team: mapTeam(rows[0]) }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, `There is already a team called ${input.name}`);
    throw err;
  }
});
