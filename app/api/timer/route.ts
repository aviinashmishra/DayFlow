import { z } from 'zod';
import { db, ms } from '@/lib/server/db';
import { body, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { activityQuery, getTask, mapTask, statusName, stopTimersQuery } from '@/lib/server/tasks';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), taskId: z.uuid() }),
  z.object({ action: z.literal('stop') })
]);

// Focus timer: one per person. Starting it moves the task to In progress.
export const POST = route(async (req) => {
  const u = await requireUser();
  const input = await body(req, schema);
  const sql = db();
  const touched = new Set<string>();
  if (u.timer) touched.add(u.timer.taskId);

  if (input.action === 'stop') {
    await stopTimersQuery(u.orgId, { userId: u.id });
    const rows = touched.size ? await sql`SELECT * FROM task_view WHERE id = ANY(${[...touched]}::uuid[]) AND org_id = ${u.orgId} AND (NOT private OR creator_id = ${u.id})` : [];
    return json({ timer: null, tasks: rows.map(mapTask) });
  }

  const task = await getTask(u, input.taskId);
  touched.add(task.id);
  const queries = [
    stopTimersQuery(u.orgId, { userId: u.id }),
    sql`UPDATE users SET timer_task_id = ${task.id}, timer_started_at = now() WHERE id = ${u.id} RETURNING timer_started_at`
  ];
  if (task.status !== 1) {
    queries.push(sql`
      UPDATE tasks SET status = 1, blocked_at = NULL, done_at = NULL, status_changed_at = now(), updated_at = now(),
        position = (SELECT coalesce(min(position), 0) - 1 FROM tasks
                    WHERE org_id = ${u.orgId} AND status = 1 AND deleted_at IS NULL AND archived_at IS NULL)
      WHERE id = ${task.id} AND org_id = ${u.orgId}`);
    queries.push(activityQuery(task.id, u.id, [`Status: ${statusName(task.status)} → In progress (focus started)`]));
  }
  queries.push(sql`SELECT * FROM task_view WHERE id = ANY(${[...touched]}::uuid[]) AND org_id = ${u.orgId} AND (NOT private OR creator_id = ${u.id})`);
  const results = await sql.transaction(queries);
  const startedAt = ms(results[1][0].timer_started_at)!;
  return json({ timer: { taskId: task.id, startedAt }, tasks: results[results.length - 1].map(mapTask) });
});
