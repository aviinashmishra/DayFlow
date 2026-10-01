import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { db, ms, type Row } from './db';
import { HttpError } from './http';
import { DEFAULT_SETTINGS, type Me, type OrgKind, type OrgRole, type Role, type Settings, type TeamMembership } from '../types';
import { isOrgAdmin, leadTeamIds } from '../access';

export const SESSION_COOKIE = 'df_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionUser {
  id: string;
  orgId: string;
  /** 'personal' until the owner creates the first team. */
  orgKind: OrgKind;
  name: string;
  email: string;
  title: string | null;
  role: OrgRole;
  /** Teams this person belongs to, with their role in each. */
  teams: TeamMembership[];
  settings: Settings;
  timer: { taskId: string; startedAt: number } | null;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (32+ characters)');
  return new TextEncoder().encode(s);
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret());
}

export function cookieOptions(req: Request) {
  const secure = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: MAX_AGE };
}

export function mapUser(r: Row): SessionUser {
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    orgKind: r.org_kind === 'personal' ? 'personal' : 'team',
    name: String(r.name),
    email: String(r.email),
    title: (r.title as string) ?? null,
    role: r.role as OrgRole,
    teams: Array.isArray(r.teams) ? (r.teams as TeamMembership[]) : [],
    settings: { ...DEFAULT_SETTINGS, ...((r.settings as Partial<Settings>) || {}) },
    timer: r.timer_task_id ? { taskId: String(r.timer_task_id), startedAt: ms(r.timer_started_at)! } : null
  };
}

/** Loads an active user with their team memberships. */
export async function loadUser(id: string): Promise<SessionUser | null> {
  const rows = await db()`
    SELECT u.id, u.org_id, u.name, u.email, u.title, u.role, u.settings, u.timer_task_id, u.timer_started_at,
           (SELECT o.kind FROM organizations o WHERE o.id = u.org_id) AS org_kind,
           coalesce((SELECT json_agg(json_build_object('teamId', m.team_id, 'role', m.role) ORDER BY m.created_at)
                     FROM team_members m WHERE m.user_id = u.id), '[]'::json) AS teams
    FROM users u WHERE u.id = ${id} AND u.deactivated_at IS NULL`;
  return rows[0] ? mapUser(rows[0]) : null;
}

/** The signed-in user, re-read from the database on every request. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    sub = payload.sub;
  } catch {
    return null;
  }
  if (!sub || !UUID.test(sub)) return null;
  return loadUser(sub);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Please sign in again');
  return u;
}

export function toMe(u: SessionUser): Me {
  return {
    id: u.id, name: u.name, role: u.role as Role, email: u.email, title: u.title, active: true, teams: u.teams,
    orgId: u.orgId, settings: u.settings, timer: u.timer
  };
}

export const isAdmin = (u: SessionUser) => isOrgAdmin(u);
/** Team ids this person leads, for SQL `team_id = ANY(...)` checks. */
export const ledTeams = (u: SessionUser) => leadTeamIds(u);

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function inviteCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

// Best-effort brute-force brake for sign-in (per server instance).
const attempts = new Map<string, { n: number; until: number }>();
export function checkRate(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.n >= 8) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
}
export function noteFailure(key: string) {
  const a = attempts.get(key);
  const fresh = !a || a.until < Date.now();
  attempts.set(key, { n: fresh ? 1 : a!.n + 1, until: Date.now() + 60_000 });
}
export function clearFailures(key: string) {
  attempts.delete(key);
}
