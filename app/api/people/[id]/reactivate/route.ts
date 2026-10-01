import { db } from '@/lib/server/db';
import { HttpError, json, route } from '@/lib/server/http';
import { isAdmin, requireUser } from '@/lib/server/auth';
import { auditQuery, getPerson } from '@/lib/server/org';

type Ctx = { params: Promise<{ id: string }> };

// Let a deactivated person sign in again (admins). Team memberships have to be re-added.
export const POST = route(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const person = await getPerson(u.orgId, id);
  if (!isAdmin(u)) throw new HttpError(403, 'Only admins can reactivate people');
  if (person.active) return json({ ok: true });
  const sql = db();
  await sql.transaction([
    sql`UPDATE users SET deactivated_at = NULL WHERE id = ${id} AND org_id = ${u.orgId}`,
    auditQuery(u.orgId, u.id, 'member.reactivated', `Reactivated ${person.name}`)
  ]);
  return json({ ok: true });
});
