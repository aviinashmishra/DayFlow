import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { auditQuery, getPerson, getTeam, notifyQuery } from '@/lib/server/org';
import { canManageTeam } from '@/lib/access';

type Ctx = { params: Promise<{ id: string; userId: string }> };
const schema = z.object({ role: z.enum(['member', 'lead']).default('member') });

// Add someone to a team, or change their role in it (admins and the team's leads).
export const PUT = route(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id, userId } = await ctx.params;
  const [team, person] = await Promise.all([getTeam(u.orgId, id), getPerson(u.orgId, userId)]);
  if (!canManageTeam(u, id)) throw new HttpError(403, 'Only admins and this team’s leads can manage its members');
  if (!person.active) throw new HttpError(400, `${person.name} is deactivated. Reactivate them first.`);
  const { role } = await body(req, schema);
  const sql = db();
  const prev = await sql`SELECT role FROM team_members WHERE team_id = ${id} AND user_id = ${userId}`;
  if (prev[0]?.role === role) return json({ ok: true, teamId: id, userId, role });
  const detail = prev[0]
    ? `${person.name} is now ${role === 'lead' ? 'a lead' : 'a member'} of ${team.name}`
    : `Added ${person.name} to ${team.name}${role === 'lead' ? ' as lead' : ''}`;
  await sql.transaction([
    sql`INSERT INTO team_members (team_id, user_id, role) VALUES (${id}, ${userId}, ${role})
        ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    auditQuery(u.orgId, u.id, prev[0] ? 'team.member_role' : 'team.member_added', detail),
    ...[notifyQuery(u.orgId, u.id, [userId], 'team', null,
      prev[0] ? `${u.name} made you ${role === 'lead' ? 'a lead' : 'a member'} of ${team.name}` : `${u.name} added you to the ${team.name} team${role === 'lead' ? ' as lead' : ''}`)]
      .filter((q) => q !== null)
  ]);
  return json({ ok: true, teamId: id, userId, role });
});

// Remove someone from a team (admins and the team's leads). Anyone may leave a team themselves.
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id, userId } = await ctx.params;
  const [team, person] = await Promise.all([getTeam(u.orgId, id), getPerson(u.orgId, userId)]);
  if (userId !== u.id && !canManageTeam(u, id)) throw new HttpError(403, 'Only admins and this team’s leads can remove members');
  const sql = db();
  const [rows] = await sql.transaction([
    sql`DELETE FROM team_members WHERE team_id = ${id} AND user_id = ${userId} RETURNING user_id`,
    auditQuery(u.orgId, u.id, 'team.member_removed', userId === u.id ? `${person.name} left ${team.name}` : `Removed ${person.name} from ${team.name}`)
  ]);
  if (!rows[0]) throw new HttpError(404, `${person.name} is not in ${team.name}`);
  return json({ ok: true });
});
