import { db, ms } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { activityQuery, assertPrivateFits, getTask, mapAttachment, mapTask, statusName, stopTimersQuery, updateTaskSchema } from '@/lib/server/tasks';
import { activePeople, assertPerson, assertTeam, notifyQuery, orgTeams, teamLeadIds } from '@/lib/server/org';
import { canManageTask } from '@/lib/access';
import { statusFields } from '@/lib/status';
import type { ActivityItem, Comment, NotificationKind, Status, TaskDetail } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };
const iso = (v: number | null) => (v == null ? null : new Date(v).toISOString());
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Task with its comments, files and activity history.
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const task = await getTask(u, id);
  const sql = db();
  const [comments, attachments, activity] = await sql.transaction(
    [
      sql`SELECT c.id, c.author_id, c.text, c.created_at, coalesce(u.name, 'Former member') AS author_name
          FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.task_id = ${id} ORDER BY c.created_at`,
      sql`SELECT a.id, a.name, a.mime, a.size, a.uploader_id, a.created_at, coalesce(u.name, 'Former member') AS uploader_name
          FROM attachments a LEFT JOIN users u ON u.id = a.uploader_id WHERE a.task_id = ${id} ORDER BY a.created_at`,
      sql`SELECT a.id, a.change, a.created_at, coalesce(u.name, 'Someone') AS actor_name
          FROM activity a LEFT JOIN users u ON u.id = a.actor_id WHERE a.task_id = ${id} ORDER BY a.created_at DESC, a.id DESC LIMIT 60`
    ],
    { readOnly: true }
  );
  const detail: TaskDetail = {
    task,
    comments: comments.map((c): Comment => ({ id: String(c.id), authorId: (c.author_id as string) ?? null, authorName: String(c.author_name), text: String(c.text), createdAt: ms(c.created_at)! })),
    attachments: attachments.map(mapAttachment),
    activity: activity.map((a): ActivityItem => ({ id: String(a.id), actorName: String(a.actor_name), change: String(a.change), createdAt: ms(a.created_at)! }))
  };
  return json(detail);
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const patch = await body(req, updateTaskSchema);
  const cur = await getTask(u, id);

  const [people, teams] = await Promise.all([activePeople(u.orgId), orgTeams(u.orgId)]);
  if (patch.assigneeId !== undefined && patch.assigneeId !== cur.assigneeId) assertPerson(people, patch.assigneeId, 'Assignee');
  if (patch.reviewerId !== undefined && patch.reviewerId !== cur.reviewerId) assertPerson(people, patch.reviewerId, 'Reviewer');
  if (patch.teamId !== undefined) assertTeam(teams, patch.teamId);
  const nameOf = (pid: string) => people.get(pid) ?? 'a former member';

  const next = { ...cur };
  const log: string[] = [];
  if (patch.title !== undefined && patch.title !== cur.title) { next.title = patch.title; log.push(`Renamed from “${cur.title}”`); }
  if (patch.teamId !== undefined && patch.teamId !== (cur.teamId ?? null)) {
    next.teamId = patch.teamId;
    log.push(patch.teamId ? `Moved to the ${teams.get(patch.teamId)} team` : 'Removed from its team');
  }
  if (patch.description !== undefined && patch.description !== cur.description) {
    next.description = patch.description;
    log.push(patch.description ? (cur.description ? 'Description edited' : 'Description added') : 'Description removed');
  }
  if (patch.remarks !== undefined && patch.remarks !== cur.remarks) {
    next.remarks = patch.remarks;
    log.push(patch.remarks ? (cur.remarks ? 'Remarks edited' : 'Remarks added') : 'Remarks removed');
  }
  if (patch.links !== undefined && JSON.stringify(patch.links) !== JSON.stringify(cur.links)) {
    const added = patch.links.length - cur.links.length;
    next.links = patch.links;
    log.push(added > 0 ? `Added ${added === 1 ? 'a link' : `${added} links`}` : added < 0 ? `Removed ${added === -1 ? 'a link' : `${-added} links`}` : 'Links edited');
  }
  if (patch.priority !== undefined && patch.priority !== cur.priority) { next.priority = patch.priority; log.push(`Priority → ${cap(patch.priority)}`); }
  if (patch.assigneeId !== undefined && patch.assigneeId !== cur.assigneeId) {
    next.assigneeId = patch.assigneeId;
    log.push(patch.assigneeId ? `Assigned to ${nameOf(patch.assigneeId)}` : 'Unassigned');
  }
  if (patch.reviewerId !== undefined && patch.reviewerId !== cur.reviewerId) {
    next.reviewerId = patch.reviewerId;
    log.push(patch.reviewerId ? `Reviewer: ${nameOf(patch.reviewerId)}` : 'Reviewer removed');
  }
  if (patch.dueDate !== undefined && patch.dueDate !== cur.dueDate) { next.dueDate = patch.dueDate; log.push(patch.dueDate ? `Due date → ${patch.dueDate}` : 'Due date removed'); }
  if (patch.tags !== undefined) {
    const tags = [...new Set(patch.tags)];
    if (tags.join(',') !== cur.tags.join(',')) { next.tags = tags; log.push(`Tags: ${tags.map((t) => '#' + t).join(' ') || 'none'}`); }
  }
  if (patch.project !== undefined && (patch.project || null) !== cur.project) { next.project = patch.project || null; log.push(next.project ? `Project → ${next.project}` : 'Project removed'); }
  if (patch.blockedReason !== undefined && (patch.blockedReason || null) !== cur.blockedReason) {
    next.blockedReason = patch.blockedReason || null;
    if (next.blockedReason) log.push(`Blocked reason: ${next.blockedReason}`);
  }
  if (patch.position !== undefined) next.position = patch.position;

  // Only the creator can make a task private. Filing a private task under a team shares it.
  let priv = cur.private;
  if (patch.private !== undefined && patch.private !== cur.private) {
    if (patch.private && cur.creatorId !== u.id) throw new HttpError(403, 'Only the person who created a task can make it private');
    priv = patch.private;
  }
  if (priv && patch.private === undefined && next.teamId) priv = false;
  if (u.orgKind === 'personal') priv = true;
  next.private = priv;
  if (priv) assertPrivateFits(u, next);
  if (priv !== cur.private) log.push(priv ? 'Made private' : 'Shared with the organization');

  const statusChanged = patch.status !== undefined && patch.status !== cur.status;
  if (statusChanged) {
    Object.assign(next, statusFields(cur, patch.status as Status, Date.now()));
    log.push(`Status: ${statusName(cur.status)} → ${statusName(patch.status!)}`);
  }

  // Who hears about this change: one notification per person, the most specific one wins.
  const notes: Array<[string | null, NotificationKind, string]> = [];
  const owner = next.assigneeId ?? next.creatorId;
  if (next.assigneeId && next.assigneeId !== cur.assigneeId) notes.push([next.assigneeId, 'assigned', `${u.name} assigned you “${next.title}”`]);
  if (next.reviewerId && (next.reviewerId !== cur.reviewerId || (statusChanged && next.status === 3))) {
    notes.push([next.reviewerId, 'review', `${u.name} asked you to review “${next.title}”`]);
  }
  if (statusChanged && next.status === 2) {
    const text = `“${next.title}” is blocked${next.blockedReason ? `: ${next.blockedReason}` : ''}`;
    for (const lead of await teamLeadIds(next.teamId)) notes.push([lead, 'blocked', text]);
    notes.push([owner, 'blocked', text]);
  }
  if (statusChanged) notes.push([owner, 'status', `${u.name} moved “${next.title}” to ${statusName(next.status)}`]);
  const told = new Set<string>();
  const noteQueries = notes.flatMap(([to, kind, text]) => {
    if (!to || told.has(to) || to === u.id) return [];
    told.add(to);
    const q = notifyQuery(u.orgId, u.id, [to], kind, id, text);
    return q ? [q] : [];
  });

  const sql = db();
  const queries = [];
  // Finishing a task stops anyone's focus timer on it and books the time.
  if (next.status === 4 && cur.status !== 4) queries.push(stopTimersQuery(u.orgId, { taskId: id }));
  queries.push(sql`
    UPDATE tasks SET
      team_id = ${next.teamId ?? null}, private = ${next.private}, title = ${next.title}, description = ${next.description}, remarks = ${next.remarks},
      links = ${JSON.stringify(next.links)}::jsonb, status = ${next.status}, priority = ${next.priority},
      assignee_id = ${next.assigneeId}, reviewer_id = ${next.reviewerId}, due_date = ${next.dueDate}::date,
      tags = ${next.tags}::text[], project = ${next.project}, blocked_reason = ${next.blockedReason},
      blocked_at = ${iso(next.blockedAt)}::timestamptz, done_at = ${iso(next.doneAt)}::timestamptz,
      status_changed_at = ${iso(next.statusChangedAt)}::timestamptz, position = ${next.position}, updated_at = now()
    WHERE id = ${id} AND org_id = ${u.orgId}`);
  if (log.length) queries.push(activityQuery(id, u.id, log));
  queries.push(...noteQueries);
  queries.push(sql`SELECT * FROM task_view WHERE id = ${id}`);
  const results = await sql.transaction(queries);
  const row = results[results.length - 1][0];
  return json({ task: mapTask(row) });
});

// Soft delete so it can be undone.
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const task = await getTask(u, id);
  if (!canManageTask(u, task)) throw new HttpError(403, 'Only the creator, the assignee, a team lead or an admin can delete this task');
  const sql = db();
  await sql.transaction([
    stopTimersQuery(u.orgId, { taskId: id }),
    sql`UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id = ${id} AND org_id = ${u.orgId}`,
    activityQuery(id, u.id, ['Deleted'])
  ]);
  return json({ ok: true });
});
