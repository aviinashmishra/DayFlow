import { json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { mapNotification, notificationsQuery, unreadQuery } from '@/lib/server/org';

export const dynamic = 'force-dynamic';

// Your latest notifications and how many are unread.
export const GET = route(async () => {
  const u = await requireUser();
  const sql = db();
  const [items, unread] = await sql.transaction([notificationsQuery(u.id), unreadQuery(u.id)], { readOnly: true });
  return json({ notifications: items.map(mapNotification), unread: Number(unread[0]?.n) || 0 }, { headers: { 'Cache-Control': 'no-store' } });
});
