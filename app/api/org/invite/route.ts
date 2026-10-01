import { db } from '@/lib/server/db';
import { HttpError, json, route } from '@/lib/server/http';
import { inviteCode, isAdmin, requireUser } from '@/lib/server/auth';
import { auditQuery } from '@/lib/server/org';

// Issue a new invite code; the old one stops working (admins).
export const POST = route(async () => {
  const u = await requireUser();
  if (!isAdmin(u)) throw new HttpError(403, 'Only admins can change the invite code');
  const code = inviteCode();
  const sql = db();
  await sql.transaction([
    sql`UPDATE organizations SET invite_code = ${code} WHERE id = ${u.orgId}`,
    auditQuery(u.orgId, u.id, 'invite.regenerated', 'Issued a new invite code; the old one stopped working')
  ]);
  return json({ inviteCode: code });
});
