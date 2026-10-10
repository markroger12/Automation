'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { ArticleDetail } from '@/lib/article-types';
import { Alert, Button, Card, Input } from '@/components/ui';

export function TitlesTab({ task, onApprove, busy }: { task: ArticleDetail; onApprove: (title: string) => void; busy: boolean }) {
  const options = JSON.parse(task.titleOptions || '[]') as string[];
  const [choice, setChoice] = useState(task.selectedTitle ?? task.recommendedTitle ?? options[0] ?? '');
  const [custom, setCustom] = useState('');
  const value = custom.trim() || choice;
  return (
    <Card title="Titles" description={task.status === 'AWAITING_TITLE_APPROVAL' ? 'Manual Title Approval is on: pick a title to continue.' : 'The title used for the article. Changing it here updates the article; regenerate Assembly to refresh the SEO title.'}>
      {options.length === 0 && <p className="text-sm text-gray-500">No title ideas yet{task.exampleTitle ? ` (example title: ${task.exampleTitle})` : ''}.</p>}
      <ul className="space-y-2">
        {options.map((o) => (
          <li key={o}>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 p-2.5 text-sm hover:bg-gray-50">
              <input type="radio" name="title" checked={!custom && choice === o} onChange={() => { setChoice(o); setCustom(''); }} className="mt-0.5" />
              <span className="flex-1">{o}</span>
              {o === task.recommendedTitle && <span className="rounded bg-emerald-50 px-1.5 text-xs text-emerald-700">recommended</span>}
              {o === task.selectedTitle && <span className="rounded bg-brand-50 px-1.5 text-xs text-brand-700">selected</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Input placeholder="…or write your own title" value={custom} onChange={(e) => setCustom(e.target.value)} />
      </div>
      {task.titleApprovedAt && <Alert type="success" className="mt-3">Approved {new Date(task.titleApprovedAt).toLocaleString()}</Alert>}
      <div className="mt-4 flex justify-end">
        <Button variant="primary" icon={<Check className="h-4 w-4" />} disabled={value.trim().length < 3} loading={busy} onClick={() => onApprove(value.trim())}>
          {task.status === 'AWAITING_TITLE_APPROVAL' ? 'Use this title and continue' : 'Use this title'}
        </Button>
      </div>
    </Card>
  );
}
