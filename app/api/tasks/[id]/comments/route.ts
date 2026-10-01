import { z } from 'zod';
import { db, ms } from '@/lib/server/db';
import { body, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { activityQuery, getTask } from '@/lib/server/tasks';
import { activePeople, mentionedIds, notifyQuery } from '@/lib/server/org';
import type { Comment } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ text: z.string().trim().min(1, 'Write something first').max(2000) });

// Comments notify the task's owner, its reviewer, and anyone @mentioned.
export const POST = route(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const { text } = await body(req, schema);
  const task = await getTask(u, id);
  const people = await activePeople(u.orgId);
  const mentioned = mentionedIds(text, people);
  const snippet = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  const followers = [task.assigneeId ?? task.creatorId, task.reviewerId].filter((x) => x && !mentioned.includes(x));

  const sql = db();
  const queries = [
    sql`INSERT INTO comments (task_id, author_id, text) VALUES (${id}, ${u.id}, ${text}) RETURNING id, created_at`,
    activityQuery(id, u.id, ['Comment added']),
    sql`UPDATE tasks SET updated_at = now() WHERE id = ${id}`,
    notifyQuery(u.orgId, u.id, mentioned, 'mention', id, `${u.name} mentioned you on “${task.title}”: ${snippet}`),
    notifyQuery(u.orgId, u.id, followers, 'comment', id, `${u.name} commented on “${task.title}”: ${snippet}`)
  ].filter((q) => q !== null);
  const [rows] = await sql.transaction(queries);
  const comment: Comment = { id: String(rows[0].id), authorId: u.id, authorName: u.name, text, createdAt: ms(rows[0].created_at)! };
  return json({ comment }, 201);
});
