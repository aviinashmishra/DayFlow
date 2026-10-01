import { z } from 'zod';
import { db, ms } from '@/lib/server/db';
import { HttpError, json, route } from '@/lib/server/http';
import { isAdmin, requireUser } from '@/lib/server/auth';
import type { AuditEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

const query = z.object({
  kind: z.enum(['all', 'org', 'task']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z.coerce.number().int().positive().optional()
});

// Organization audit trail (admins): people, roles, teams and invites, merged with every task change.
export const GET = route(async (req) => {
  const u = await requireUser();
  if (!isAdmin(u)) throw new HttpError(403, 'Only admins can see the audit log');
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const before = q.before ? new Date(q.before).toISOString() : null;
  const rows = await db()`
    SELECT * FROM (
      SELECT 'org' AS source, 'o' || a.id AS id, a.action, a.detail, a.created_at,
             coalesce(p.name, 'Someone') AS actor_name, NULL::uuid AS task_id, NULL::text AS task_title
      FROM audit_log a LEFT JOIN users p ON p.id = a.actor_id
      WHERE a.org_id = ${u.orgId} AND ${q.kind} IN ('all', 'org')
      UNION ALL
      SELECT 'task', 't' || c.id, 'task', c.change, c.created_at,
             coalesce(p.name, 'Someone'), t.id, t.title
      FROM activity c JOIN tasks t ON t.id = c.task_id LEFT JOIN users p ON p.id = c.actor_id
      WHERE t.org_id = ${u.orgId} AND ${q.kind} IN ('all', 'task') AND (NOT t.private OR t.creator_id = ${u.id})
    ) x
    WHERE (${before}::timestamptz IS NULL OR x.created_at < ${before}::timestamptz)
    ORDER BY x.created_at DESC, x.id DESC
    LIMIT ${q.limit}`;
  const entries: AuditEntry[] = rows.map((r) => ({
    id: String(r.id),
    source: r.source as AuditEntry['source'],
    action: String(r.action),
    detail: String(r.detail),
    actorName: String(r.actor_name),
    taskId: (r.task_id as string) ?? null,
    taskTitle: (r.task_title as string) ?? null,
    createdAt: ms(r.created_at)!
  }));
  return json({ entries, more: entries.length === q.limit }, { headers: { 'Cache-Control': 'no-store' } });
});
