import { redirect } from 'next/navigation';
import { userCount } from '@/server/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if ((await userCount()) === 0) redirect('/setup');
  return <LoginForm />;
}
