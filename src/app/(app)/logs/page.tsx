import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { LogList } from '@/components/log-list';

export default function LogsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Logs" icon={<ScrollText className="h-5 w-5" />} description="Everything the worker, ChatGPT extension and WordPress automation did. Failure screenshots open from the entry." />
      <LogList autoRefresh />
    </div>
  );
}
