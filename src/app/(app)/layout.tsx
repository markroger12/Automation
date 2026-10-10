import { redirect } from 'next/navigation';
import { getSessionUser, userCount } from '@/server/auth';
import { AppShell } from '@/components/app-shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect((await userCount()) === 0 ? '/setup' : '/login');
  }
  return <AppShell user={{ name: user.name, email: user.email, role: user.role }}>{children}</AppShell>;
}
