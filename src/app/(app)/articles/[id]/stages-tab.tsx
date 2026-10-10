'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCcw } from 'lucide-react';
import type { ArticleDetail, StageRow } from '@/lib/article-types';
import { STAGE_STATUS_COLOR } from '@/lib/status';
import { Badge, Button } from '@/components/ui';

function duration(s: StageRow): string {
  if (!s.startedAt || !s.completedAt) return '';
  const sec = Math.max(0, Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000));
  return sec < 90 ? `${sec} s` : `${Math.round(sec / 60)} min`;
}

export function StagesTab({ task, working, onRegenerate }: { task: ArticleDetail; working: boolean; onRegenerate: (key: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <ul className="divide-y divide-gray-100">
        {task.stages.map((s) => (
          <StageItem key={s.id} stage={s} canRegenerate={!working && !['TITLE_APPROVAL', 'ARTICLE_APPROVAL'].includes(s.key) && (s.status === 'COMPLETED' || s.status === 'FAILED' || s.status === 'SKIPPED')} onRegenerate={() => onRegenerate(s.key)} />
        ))}
      </ul>
    </div>
  );
}

function StageItem({ stage, canRegenerate, onRegenerate }: { stage: StageRow; canRegenerate: boolean; onRegenerate: () => void }) {
  const [open, setOpen] = useState(false);
  const data = stage.data ? (() => { try { return JSON.parse(stage.data) as Record<string, unknown>; } catch { return null; } })() : null;
  const hasDetails = !!(stage.output || stage.prompt || stage.error || data);
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <button className={hasDetails ? 'text-gray-400' : 'invisible'} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="w-6 text-xs text-gray-400">{stage.position + 1}</span>
        <span className="flex-1 text-sm font-medium text-gray-800">{stage.label}</span>
        {stage.attempts > 1 && <span className="text-xs text-gray-500">{stage.attempts} attempts</span>}
        <span className="text-xs text-gray-500">{duration(stage)}</span>
        <Badge color={STAGE_STATUS_COLOR[stage.status]}>{stage.status.toLowerCase()}</Badge>
        <Button size="xs" variant="ghost" icon={<RefreshCcw className="h-3 w-3" />} onClick={() => confirm(`Regenerate "${stage.label}"? Later stages that depend on it run again too.`) && onRegenerate()} disabled={!canRegenerate}>
          Regenerate
        </Button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 pl-14">
          {stage.error && <div className="rounded bg-red-50 p-2 text-xs text-red-800">{stage.error}</div>}
          {stage.output && (
            <details open>
              <summary className="cursor-pointer text-xs font-medium text-gray-600">Output</summary>
              <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">{stage.output}</pre>
            </details>
          )}
          {stage.prompt && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-gray-600">Prompt</summary>
              <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">{stage.prompt}</pre>
            </details>
          )}
          {data && Object.keys(data).length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-gray-600">Stage data</summary>
              <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">{JSON.stringify(data, null, 2).slice(0, 20000)}</pre>
            </details>
          )}
        </div>
      )}
    </li>
  );
}
