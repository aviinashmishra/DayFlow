/*
 * Permission rules, shared by the API (which enforces them) and the UI
 * (which only uses them to hide actions a person cannot take).
 *
 *   owner   everything, including granting or removing the owner role
 *   admin   people, roles (except owner), teams, invites, any task, audit log
 *   lead    per team: that team's members and tasks
 *   member  add and edit tasks; delete or clear the ones they created or own
 */
import type { OrgRole, Task, TeamMembership } from './types';

export interface Actor {
  id: string;
  role: string;
  teams: TeamMembership[];
}

export const isOrgAdmin = (a: Actor) => a.role === 'admin' || a.role === 'owner';
export const isOwner = (a: Actor) => a.role === 'owner';

export const leadsTeam = (a: Actor, teamId: string | null | undefined) =>
  !!teamId && a.teams.some((m) => m.teamId === teamId && m.role === 'lead');

export const leadTeamIds = (a: Actor) => a.teams.filter((m) => m.role === 'lead').map((m) => m.teamId);

export const canManageTeam = (a: Actor, teamId: string | null | undefined) => isOrgAdmin(a) || leadsTeam(a, teamId);

/** Delete a task, clear it from Done, or remove other people's files on it. */
export function canManageTask(a: Actor, t: Pick<Task, 'creatorId' | 'assigneeId'> & { teamId?: string | null }) {
  return isOrgAdmin(a) || t.creatorId === a.id || t.assigneeId === a.id || leadsTeam(a, t.teamId ?? null);
}

/** Why `actor` may not give `target` the role `next`, or null when allowed. */
export function roleChangeError(actor: Actor, target: { id: string; role: string }, next: OrgRole): string | null {
  if (actor.id === target.id) return 'You cannot change your own role. Ask another admin.';
  if (!isOrgAdmin(actor)) return 'Only admins can change roles';
  if ((target.role === 'owner' || next === 'owner') && !isOwner(actor)) return 'Only the owner can grant or remove the owner role';
  return null;
}

/** Why `actor` may not deactivate `target`, or null when allowed. */
export function deactivateError(actor: Actor, target: { id: string; role: string }): string | null {
  if (actor.id === target.id) return 'You cannot deactivate yourself';
  if (!isOrgAdmin(actor)) return 'Only admins can deactivate people';
  if (target.role === 'owner' && !isOwner(actor)) return 'Only the owner can deactivate another owner';
  return null;
}
