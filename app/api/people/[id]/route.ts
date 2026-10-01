import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { isAdmin, requireUser } from '@/lib/server/auth';
import { auditQuery, getPerson } from '@/lib/server/org';
import { stopTimersQuery } from '@/lib/server/tasks';
import { deactivateError, roleChangeError } from '@/lib/access';

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({
  role: z.enum(['member', 'admin', 'owner']).optional(),
  title: z.string().trim().max(80).optional()
});

// Change someone's organization role or job title (admins; owner rules in lib/access).
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const person = await getPerson(u.orgId, id);
  const input = await body(req, schema);
  if (input.title !== undefined && id !== u.id && !isAdmin(u)) throw new HttpError(403, 'Only admins can edit other people’s titles');
  if (input.role !== undefined && input.role !== person.role) {
    const why = roleChangeError(u, person, input.role);
    if (why) throw new HttpError(id === u.id ? 400 : 403, why);
  }
  const sql = db();
  const queries = [];
  if (input.role !== undefined && input.role !== person.role) {
    queries.push(sql`UPDATE users SET role = ${input.role} WHERE id = ${id} AND org_id = ${u.orgId}`);
    queries.push(auditQuery(u.orgId, u.id, 'member.role', `${person.name}: ${person.role} → ${input.role}`));
  }
  if (input.title !== undefined) {
    queries.push(sql`UPDATE users SET title = nullif(${input.title}, '') WHERE id = ${id} AND org_id = ${u.orgId}`);
  }
  if (queries.length) await sql.transaction(queries);
  const rows = await sql`SELECT id, name, role, title FROM users WHERE id = ${id}`;
  return json({ member: { id: String(rows[0].id), name: String(rows[0].name), role: String(rows[0].role), title: (rows[0].title as string) ?? null } });
});

// Deactivate: the person can no longer sign in or be assigned. Their work and history stay.
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const person = await getPerson(u.orgId, id);
  const why = deactivateError(u, person);
  if (why) throw new HttpError(id === u.id ? 400 : 403, why);
  if (!person.active) return json({ ok: true });
  const sql = db();
  await sql.transaction([
    stopTimersQuery(u.orgId, { userId: id }),
    sql`UPDATE users SET deactivated_at = now() WHERE id = ${id} AND org_id = ${u.orgId}`,
    sql`DELETE FROM team_members WHERE user_id = ${id}`,
    auditQuery(u.orgId, u.id, 'member.deactivated', `Deactivated ${person.name}`)
  ]);
  return json({ ok: true });
});
