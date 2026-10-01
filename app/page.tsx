import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';
import { loadBoard } from '@/lib/server/tasks';
import ClientApp from '@/components/ClientApp';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const data = await loadBoard(user);
  return <ClientApp initial={data} />;
}
