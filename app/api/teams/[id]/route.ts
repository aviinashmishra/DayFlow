import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { isAdmin, requireUser } from '@/lib/server/auth';
import { auditQuery, getTeam, mapTeam, teamFields } from '@/lib/server/org';
import { canManageTeam } from '@/lib/access';

type Ctx = { params: Promise<{ id: string }> };

// Rename or recolor a team (admins, or that team's leads).
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const team = await getTeam(u.orgId, id);
  if (!canManageTeam(u, id)) throw new HttpError(403, 'Only admins and this team’s leads can edit it');
  const input = await body(req, teamFields.partial());
  const next = { name: input.name ?? team.name, description: input.description !== undefined ? input.description : team.description, color: input.color ?? team.color };
  const changes = [
    next.name !== team.name && `renamed it to ${next.name}`,
    next.description !== team.description && 'updated the description',
    next.color !== team.color && 'changed the color'
  ].filter(Boolean);
  const sql = db();
  try {
    const [rows] = await sql.transaction([
      sql`UPDATE teams SET name = ${next.name}, description = ${next.description}, color = ${next.color}
          WHERE id = ${id} AND org_id = ${u.orgId} RETURNING id, name, description, color`,
      ...(changes.length ? [auditQuery(u.orgId, u.id, 'team.updated', `${team.name} team: ${changes.join(', ')}`)] : [])
    ]);
    return json({ team: mapTeam(rows[0]) });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, `There is already a team called ${next.name}`);
    throw err;
  }
});

// Delete a team (admins). Its tasks stay, without a team; memberships go.
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const team = await getTeam(u.orgId, id);
  if (!isAdmin(u)) throw new HttpError(403, 'Only admins can delete teams');
  const sql = db();
  const [moved] = await sql.transaction([
    sql`SELECT count(*)::int AS n FROM tasks WHERE team_id = ${id} AND deleted_at IS NULL`,
    sql`DELETE FROM teams WHERE id = ${id} AND org_id = ${u.orgId}`,
    auditQuery(u.orgId, u.id, 'team.deleted', `Deleted the ${team.name} team`)
  ]);
  return json({ ok: true, tasksWithoutTeam: Number(moved[0]?.n) || 0 });
});
