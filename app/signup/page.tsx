import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';
import { AuthForm } from '@/components/AuthForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create account · Dayflow' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string; team?: string; mode?: string }> }) {
  if (await currentUser()) redirect('/');
  const { invite, team, mode } = await searchParams;
  const code = typeof invite === 'string' ? invite.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : undefined;
  // The team link is checked by the server; pass it only when it looks like an id.
  const teamId = typeof team === 'string' && /^[0-9a-f-]{36}$/i.test(team) ? team : undefined;
  // /signup?mode=team opens on the organization option (default: just me).
  const start = mode === 'team' || mode === 'org' ? 'org' : mode === 'join' ? 'join' : 'personal';
  return <AuthForm mode="signup" invite={code} teamId={teamId} start={start} />;
}
