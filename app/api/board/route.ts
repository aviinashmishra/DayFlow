import { json, route } from '@/lib/server/http';
import { requireUser } from '@/lib/server/auth';
import { loadBoard } from '@/lib/server/tasks';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const u = await requireUser();
  return json(await loadBoard(u), { headers: { 'Cache-Control': 'no-store' } });
});
