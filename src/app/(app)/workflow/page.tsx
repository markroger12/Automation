import { getSessionUser } from '@/server/auth';
import { WorkflowView } from './workflow-view';

export const dynamic = 'force-dynamic';

export default async function WorkflowPage({ searchParams }: { searchParams: Promise<{ website?: string }> }) {
  const user = await getSessionUser();
  const { website } = await searchParams;
  return <WorkflowView isAdmin={user?.role === 'ADMIN'} initialWebsiteId={website ?? null} />;
}
