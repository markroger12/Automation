import { ListOrdered } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { TaskTable } from '@/components/task-table';

export default function QueuePage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Article Queue" icon={<ListOrdered className="h-5 w-5" />} description="Articles waiting or being written. The worker runs as many at once as Task Concurrency in Settings." />
      <TaskTable view="queue" />
    </div>
  );
}
