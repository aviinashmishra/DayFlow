import 'server-only';
import { z } from 'zod';
import { db, ms, type Row } from './db';
import { HttpError } from './http';
import type { AppNotification, Member, NotificationKind, OrgTeam, Role, TeamMembership } from '../types';

/** Editable team fields (create uses all, edit uses any). */
export const teamFields = z.object({
  name: z.string().trim().min(1, 'Give the team a name').max(60),
  description: z.string().trim().max(300).transform((v) => v || null).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB color').optional()
});

export function mapMember(r: Row): Member {
  return {
    id: String(r.id),
    name: String(r.name),
    role: r.role as Role,
    email: String(r.email ?? ''),
    title: (r.title as string) ?? null,
    active: !r.deactivated_at,
    teams: Array.isArray(r.teams) ? (r.teams as TeamMembership[]) : []
  };
}

export function mapTeam(r: Row): OrgTeam {
  return { id: String(r.id), name: String(r.name), description: (r.description as string) ?? null, color: String(r.color) };
}

export function mapNotification(r: Row): AppNotification {
  return {
    id: String(r.id),
    kind: r.kind as NotificationKind,
    text: String(r.text),
    taskId: (r.task_id as string) ?? null,
    actorName: (r.actor_name as string) ?? null,
    createdAt: ms(r.created_at) ?? Date.now(),
    read: !!r.read_at
  };
}

/** Everyone in the organization (active first), with their team memberships. */
export function membersQuery(orgId: string) {
  return db()`
    SELECT u.id, u.name, u.role, u.title, u.email, u.deactivated_at,
           coalesce(json_agg(json_build_object('teamId', m.team_id, 'role', m.role) ORDER BY m.created_at)
                    FILTER (WHERE m.team_id IS NOT NULL), '[]'::json) AS teams
    FROM users u LEFT JOIN team_members m ON m.user_id = u.id
    WHERE u.org_id = ${orgId}
    GROUP BY u.id
    ORDER BY u.deactivated_at IS NOT NULL, lower(u.name)`;
}

export function teamsQuery(orgId: string) {
  return db()`SELECT id, name, description, color FROM teams WHERE org_id = ${orgId} ORDER BY lower(name)`;
}

export function notificationsQuery(userId: string) {
  return db()`
    SELECT n.id, n.kind, n.text, n.task_id, n.read_at, n.created_at, a.name AS actor_name
    FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
    WHERE n.user_id = ${userId} ORDER BY n.created_at DESC, n.id DESC LIMIT 40`;
}

export function unreadQuery(userId: string) {
  return db()`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`;
}

/** Active people in the organization: id → name. Used to validate assignees and reviewers. */
export async function activePeople(orgId: string): Promise<Map<string, string>> {
  const rows = await db()`SELECT id, name FROM users WHERE org_id = ${orgId} AND deactivated_at IS NULL`;
  return new Map(rows.map((r) => [String(r.id), String(r.name)]));
}

export function assertPerson(people: Map<string, string>, id: string | null | undefined, label: string) {
  if (id && !people.has(id)) throw new HttpError(400, `${label} is not an active member of your organization`);
}

/** Teams in the organization: id → name. */
export async function orgTeams(orgId: string): Promise<Map<string, string>> {
  const rows = await db()`SELECT id, name FROM teams WHERE org_id = ${orgId}`;
  return new Map(rows.map((r) => [String(r.id), String(r.name)]));
}

export function assertTeam(teams: Map<string, string>, id: string | null | undefined) {
  if (id && !teams.has(id)) throw new HttpError(400, 'That team is not in your organization');
}

export async function getTeam(orgId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, 'Team not found');
  const rows = await db()`SELECT id, name, description, color FROM teams WHERE id = ${id} AND org_id = ${orgId}`;
  if (!rows[0]) throw new HttpError(404, 'Team not found');
  return mapTeam(rows[0]);
}

export async function getPerson(orgId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, 'Person not found');
  const rows = await db()`SELECT id, name, role, deactivated_at FROM users WHERE id = ${id} AND org_id = ${orgId}`;
  if (!rows[0]) throw new HttpError(404, 'Person not found');
  return { id: String(rows[0].id), name: String(rows[0].name), role: String(rows[0].role), active: !rows[0].deactivated_at };
}

/** Leads of a team (for "blocked" alerts). */
export async function teamLeadIds(teamId: string | null | undefined): Promise<string[]> {
  if (!teamId) return [];
  const rows = await db()`SELECT user_id FROM team_members WHERE team_id = ${teamId} AND role = 'lead'`;
  return rows.map((r) => String(r.user_id));
}

/**
 * Notifies people about something `actorId` did. The actor, duplicates and
 * deactivated or out-of-org accounts are skipped. Returns null when nobody is left,
 * so callers can filter it out of a transaction.
 */
export function notifyQuery(orgId: string, actorId: string, recipients: Array<string | null | undefined>, kind: NotificationKind, taskId: string | null, text: string) {
  const ids = [...new Set(recipients.filter((x): x is string => !!x && x !== actorId))];
  if (!ids.length) return null;
  return db()`
    INSERT INTO notifications (org_id, user_id, actor_id, kind, task_id, text)
    SELECT ${orgId}, u.id, ${actorId}, ${kind}, ${taskId}::uuid, ${text.slice(0, 300)}
    FROM users u WHERE u.id = ANY(${ids}::uuid[]) AND u.org_id = ${orgId} AND u.deactivated_at IS NULL`;
}

/** Records an organization-level event (people, roles, teams, invites). */
export function auditQuery(orgId: string, actorId: string | null, action: string, detail: string) {
  return db()`INSERT INTO audit_log (org_id, actor_id, action, detail) VALUES (${orgId}, ${actorId}, ${action}, ${detail.slice(0, 500)})`;
}

/** People named with @FirstName (or @Full Name) in a comment. */
export function mentionedIds(text: string, people: Map<string, string>): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const [id, name] of people) {
    const full = name.toLowerCase();
    const first = full.split(/\s+/)[0];
    const hit = (needle: string) => new RegExp(`(^|[^\\w@])@${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i').test(lower);
    if (hit(full.replace(/\s+/g, ' ')) || hit(first)) out.push(id);
  }
  return out;
}
