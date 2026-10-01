import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { assertPrivateFits, createTaskSchema, mapTask, statusName } from '@/lib/server/tasks';
import { activePeople, assertPerson, assertTeam, orgTeams } from '@/lib/server/org';

const schema = z.object({ tasks: z.array(createTaskSchema).min(1).max(50) });

// Create one or more tasks. Client-generated ids make retries (offline outbox) idempotent.
export const POST = route(async (req) => {
  const u = await requireUser();
  const { tasks } = await body(req, schema);
  // In a personal space every task is private, so creating a team later never exposes them.
  if (u.orgKind === 'personal') tasks.forEach((t) => { t.private = true; });
  const [people, teams] = await Promise.all([activePeople(u.orgId), orgTeams(u.orgId)]);
  tasks.forEach((t) => {
    assertPerson(people, t.assigneeId, 'Assignee');
    assertTeam(teams, t.teamId);
    if (t.private) assertPrivateFits(u, t);
  });

  const sql = db();
  const queries = tasks.flatMap((t) => {
    const q = [
      sql`
        INSERT INTO tasks (id, org_id, team_id, private, title, description, remarks, links, status, priority, assignee_id, creator_id, due_date,
                           tags, project, blocked_reason, blocked_at, done_at, position, source)
        VALUES (${t.id}, ${u.orgId}, ${t.teamId}, ${t.private}, ${t.title}, ${t.description}, ${t.remarks}, ${JSON.stringify(t.links)}::jsonb, ${t.status},
                ${t.priority}, ${t.assigneeId}, ${u.id}, ${t.dueDate}::date,
                ${t.tags}::text[], ${t.project || null}, ${t.status === 2 ? t.blockedReason : null},
                ${t.status === 2 ? new Date().toISOString() : null}::timestamptz,
                ${t.status === 4 ? new Date().toISOString() : null}::timestamptz, ${t.position}, ${t.source})
        ON CONFLICT (id) DO NOTHING`,
      // Only log creation for rows inserted in this transaction (now() is the transaction time).
      sql`
        INSERT INTO activity (task_id, actor_id, change)
        SELECT id, ${u.id}, ${`Created ${t.source === 'voice' ? 'by voice' : 'by typing'} in ${statusName(t.status)}${t.teamId ? ` · ${teams.get(t.teamId)}` : t.private ? ' · private' : ''}`}
        FROM tasks WHERE id = ${t.id} AND org_id = ${u.orgId} AND created_at = now()`
    ];
    // Only notify for rows created in this request (a replayed create stays silent).
    const note = t.assigneeId && t.assigneeId !== u.id
      ? sql`
          INSERT INTO notifications (org_id, user_id, actor_id, kind, task_id, text)
          SELECT ${u.orgId}, ${t.assigneeId}, ${u.id}, 'assigned', id, ${`${u.name} assigned you “${t.title}”`.slice(0, 300)}
          FROM tasks WHERE id = ${t.id} AND org_id = ${u.orgId} AND created_at = now()`
      : null;
    if (note) q.push(note);
    return q;
  });
  await sql.transaction(queries);

  const ids = tasks.map((t) => t.id);
  const rows = await sql`SELECT * FROM task_view WHERE id = ANY(${ids}::uuid[]) AND org_id = ${u.orgId} AND (NOT private OR creator_id = ${u.id})`;
  return json({ tasks: rows.map(mapTask) }, 201);
});
