import { redirect } from 'next/navigation';
import { userCount } from '@/server/auth';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if ((await userCount()) > 0) redirect('/login');
  return <SetupForm />;
}
