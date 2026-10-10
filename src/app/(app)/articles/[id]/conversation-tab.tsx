'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { Badge, EmptyState, Loading } from '@/components/ui';

type Resp = { id: string; stageKey: string; attempt: number; prompt: string; responseText: string; conversationUrl: string | null; reusedExisting: boolean; durationMs: number | null; createdAt: string };

export function ConversationTab({ taskId, conversationUrl }: { taskId: string; conversationUrl: string | null }) {
  const [rows, setRows] = useState<Resp[] | null>(null);
  useEffect(() => {
    api<{ responses: Resp[] }>(`/api/tasks/${taskId}/responses`).then((r) => setRows(r.responses));
  }, [taskId]);
  if (!rows) return <Loading />;
  if (!rows.length) return <EmptyState title="No ChatGPT answers yet" />;
  return (
    <div className="space-y-4">
      {conversationUrl && (
        <a href={conversationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
          Open the conversation on chatgpt.com <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      {rows.map((r) => (
        <div key={r.id} className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Badge color="blue">{r.stageKey}</Badge>
            {r.attempt > 1 && <span>attempt {r.attempt}</span>}
            {r.reusedExisting && <Badge color="purple">recovered from the chat</Badge>}
            <span>{new Date(r.createdAt).toLocaleString()}</span>
            {r.durationMs !== null && <span>· {Math.round(r.durationMs / 1000)} s</span>}
          </div>
          <div className="ml-auto max-w-[85%] rounded-2xl bg-gray-100 px-4 py-2 text-sm whitespace-pre-wrap text-gray-800">
            <details>
              <summary className="cursor-pointer text-gray-600">{r.prompt.slice(0, 160)}{r.prompt.length > 160 ? '…' : ''}</summary>
              <div className="mt-2">{r.prompt}</div>
            </details>
          </div>
          <div className="max-w-[95%] rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm whitespace-pre-wrap text-gray-800">{r.responseText}</div>
        </div>
      ))}
    </div>
  );
}
