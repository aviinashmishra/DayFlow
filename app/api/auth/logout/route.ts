import { json, route } from '@/lib/server/http';
import { cookieOptions, SESSION_COOKIE } from '@/lib/server/auth';

export const POST = route(async (req) => {
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(req), maxAge: 0 });
  return res;
});
