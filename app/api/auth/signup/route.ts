import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { cookieOptions, hashPassword, inviteCode, SESSION_COOKIE, signSession } from '@/lib/server/auth';
import { seedStarterTasks } from '@/lib/server/starter';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  email: z.string().trim().toLowerCase().max(200).email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  // 'personal': a space just for you (create a team later). 'org' (default): an organization with a first team.
  mode: z.enum(['personal', 'org']).optional(),
  // New organization. `teamName` is the older field name, still accepted.
  orgName: z.string().trim().max(80).optional(),
  teamName: z.string().trim().max(80).optional(),
  firstTeam: z.string().trim().max(60).optional(),
  // Joining: the organization's invite code, and optionally the team to join.
  inviteCode: z.string().trim().toUpperCase().max(20).optional(),
  teamId: z.uuid().optional()
});

export const POST = route(async (req) => {
  const input = await body(req, schema);
  const sql = db();
  const exists = await sql`SELECT 1 FROM users WHERE lower(email) = ${input.email}`;
  if (exists.length) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');

  const hash = await hashPassword(input.password);
  const firstName = input.name.split(' ')[0];
  let userId: string;
  let orgId: string;
  let starter: 'personal' | 'org' | null = null;
  try {
    if (input.inviteCode) {
      const org = await sql`SELECT id FROM organizations WHERE invite_code = ${input.inviteCode} AND kind = 'team'`;
      if (!org[0]) throw new HttpError(400, 'That invite code was not found. Check it with your admin.');
      orgId = String(org[0].id);
      // Join the invited team if it belongs to this organization, otherwise the oldest team.
      const team = await sql`
        SELECT id, name FROM teams WHERE org_id = ${orgId}
        ORDER BY (id = ${input.teamId ?? null}::uuid) DESC NULLS LAST, created_at LIMIT 1`;
      const teamId = team[0] ? String(team[0].id) : null;
      const detail = `${input.name} joined${team[0] ? ` the ${team[0].name} team` : ''}`;
      const rows = await sql`
        WITH u AS (INSERT INTO users (org_id, name, email, password_hash, role)
                   VALUES (${orgId}, ${input.name}, ${input.email}, ${hash}, 'member') RETURNING id),
             m AS (INSERT INTO team_members (team_id, user_id, role) SELECT ${teamId}::uuid, u.id, 'member' FROM u WHERE ${teamId}::uuid IS NOT NULL),
             a AS (INSERT INTO audit_log (org_id, actor_id, action, detail) SELECT ${orgId}, u.id, 'member.joined', ${detail} FROM u)
        SELECT id FROM u`;
      userId = String(rows[0].id);
    } else if (input.mode === 'personal') {
      // A space for one person: no teams until they create one.
      const spaceName = input.orgName || `${firstName}'s space`;
      const rows = await sql`
        WITH o AS (INSERT INTO organizations (name, kind, invite_code) VALUES (${spaceName}, 'personal', ${inviteCode()}) RETURNING id),
             u AS (INSERT INTO users (org_id, name, email, password_hash, role)
                   SELECT o.id, ${input.name}, ${input.email}, ${hash}, 'owner' FROM o RETURNING id, org_id),
             a AS (INSERT INTO audit_log (org_id, actor_id, action, detail) SELECT u.org_id, u.id, 'org.created', 'Started a personal space' FROM u)
        SELECT id, org_id FROM u`;
      userId = String(rows[0].id);
      orgId = String(rows[0].org_id);
      starter = 'personal';
    } else {
      const orgName = input.orgName || input.teamName || `${firstName}'s organization`;
      const teamName = input.firstTeam || 'General';
      // Organization, owner, first team and membership in one statement, so a failure leaves nothing behind.
      const rows = await sql`
        WITH o AS (INSERT INTO organizations (name, kind, invite_code) VALUES (${orgName}, 'team', ${inviteCode()}) RETURNING id),
             u AS (INSERT INTO users (org_id, name, email, password_hash, role)
                   SELECT o.id, ${input.name}, ${input.email}, ${hash}, 'owner' FROM o RETURNING id, org_id),
             t AS (INSERT INTO teams (org_id, name, description) SELECT o.id, ${teamName}, 'Your first team' FROM o RETURNING id),
             m AS (INSERT INTO team_members (team_id, user_id, role) SELECT t.id, u.id, 'lead' FROM t, u),
             a AS (INSERT INTO audit_log (org_id, actor_id, action, detail) SELECT u.org_id, u.id, 'org.created', ${`Created ${orgName}`} FROM u)
        SELECT id, org_id FROM u`;
      userId = String(rows[0].id);
      orgId = String(rows[0].org_id);
      starter = 'org';
    }
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    throw err;
  }
  // A few private "getting started" cards, so the board is never empty on day one. Best effort.
  if (starter) {
    try { await seedStarterTasks(orgId, userId, starter); } catch (err) { console.error('starter tasks', err); }
  }
  const res = json({ ok: true, user: { id: userId, name: input.name } }, 201);
  res.cookies.set(SESSION_COOKIE, await signSession(userId), cookieOptions(req));
  return res;
});
