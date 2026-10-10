import { Clock } from 'lucide-react';
import { getModule } from '@/modules/registry';
import { EmptyState, PageHeader } from '@/components/ui';
import { ModuleIcon } from '@/components/icons';

export default async function ComingSoonPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const mod = getModule(key);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={mod?.name ?? 'Coming soon'} icon={<ModuleIcon name={mod?.icon ?? 'FileText'} className="h-5 w-5" />} description={mod?.description} />
      <EmptyState title="Coming soon" icon={<Clock className="h-8 w-8" />}>
        This module is planned. The writers and SEO tools in the sidebar are ready to use.
      </EmptyState>
    </div>
  );
}
