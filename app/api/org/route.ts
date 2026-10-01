import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { isAdmin, requireUser } from '@/lib/server/auth';
import { auditQuery } from '@/lib/server/org';

const schema = z.object({ name: z.string().trim().min(1).max(80) });

// Rename the organization (admins).
export const PATCH = route(async (req) => {
  const u = await requireUser();
  if (!isAdmin(u)) throw new HttpError(403, 'Only admins can rename the organization');
  const { name } = await body(req, schema);
  const sql = db();
  const [old] = await sql.transaction([
    sql`SELECT name FROM organizations WHERE id = ${u.orgId}`,
    sql`UPDATE organizations SET name = ${name} WHERE id = ${u.orgId}`,
    auditQuery(u.orgId, u.id, 'org.renamed', `Renamed the organization to ${name}`)
  ]);
  return json({ ok: true, name, previous: old[0]?.name ?? null });
});
