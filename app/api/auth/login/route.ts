import { z } from 'zod';
import { db } from '@/lib/server/db';
import { body, HttpError, json, route } from '@/lib/server/http';
import { checkRate, clearFailures, cookieOptions, noteFailure, SESSION_COOKIE, signSession, verifyPassword } from '@/lib/server/auth';

const schema = z.object({
  email: z.string().trim().toLowerCase().max(200),
  password: z.string().min(1).max(200)
});

export const POST = route(async (req) => {
  const input = await body(req, schema);
  const key = `${input.email}|${req.headers.get('x-forwarded-for') || 'local'}`;
  checkRate(key);
  const rows = await db()`SELECT id, password_hash, deactivated_at FROM users WHERE lower(email) = ${input.email}`;
  const ok = rows[0] ? await verifyPassword(input.password, String(rows[0].password_hash)) : false;
  if (!ok) {
    noteFailure(key);
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  clearFailures(key);
  // Only said after a correct password, so it does not reveal which emails exist.
  if (rows[0].deactivated_at) throw new HttpError(403, 'This account has been deactivated. Ask an admin in your organization to reactivate it.');
  await db()`UPDATE users SET last_seen_at = now() WHERE id = ${rows[0].id}`;
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(String(rows[0].id)), cookieOptions(req));
  return res;
});
