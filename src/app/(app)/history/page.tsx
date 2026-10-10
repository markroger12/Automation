import { History } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { TaskTable } from '@/components/task-table';

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Article History" icon={<History className="h-5 w-5" />} description="Every article. Open one to edit it, regenerate a stage, read the ChatGPT conversation or send it to WordPress." />
      <TaskTable view="all" />
    </div>
  );
}
