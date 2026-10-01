import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';
import { AuthForm } from '@/components/AuthForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Dayflow' };

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return <AuthForm mode="login" />;
}
