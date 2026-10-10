'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, MessageSquare, RotateCcw, Send, Square, Trash2, Gauge } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { STATUS_LABEL, isActiveStatus, statusColor } from '@/lib/status';
import type { ArticleDetail } from '@/lib/article-types';
import { moduleName } from '@/modules/registry';
import { Alert, Badge, Button, Loading, ProgressBar, Tabs } from '@/components/ui';
import { LogList } from '@/components/log-list';
import { OverviewTab } from './overview-tab';
import { TitlesTab } from './titles-tab';
import { EditorTab } from './editor-tab';
import { StagesTab } from './stages-tab';
import { ConversationTab } from './conversation-tab';

type Tab = 'overview' | 'titles' | 'editor' | 'stages' | 'logs' | 'conversation';

export function ArticleView({ id }: { id: string }) {
  const router = useRouter();
  const [task, setTask] = useState<ArticleDetail | null>(null);
  const [activeJob, setActiveJob] = useState<{ id: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(
    () =>
      api<{ task: ArticleDetail; activeJob: { id: string; status: string } | null }>(`/api/tasks/${id}`)
        .then((r) => {
          setTask(r.task);
          setActiveJob(r.activeJob);
        })
        .catch((e) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!task) return;
    const running = isActiveStatus(task.status) || !!activeJob;
    if (!running || tab === 'editor') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [task, activeJob, tab, load]);

  useEffect(() => {
    if (task?.status === 'AWAITING_TITLE_APPROVAL') setTab((t) => (t === 'overview' ? 'titles' : t));
  }, [task?.status]);

  if (!task) return error ? <Alert type="error">{error}</Alert> : <Loading />;

  async function action(name: string, body: Record<string, unknown> = {}, message?: string) {
    setBusy(name);
    setNotice(null);
    try {
      const r = await api<{ score?: number }>(`/api/tasks/${id}/actions`, { body: { action: name, ...body } });
      setNotice({ type: 'success', text: message ?? (r.score !== undefined ? `SEO Readiness Score: ${r.score}` : 'Done.') });
      await load();
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm('Delete this article? The WordPress draft (if any) stays in WordPress.')) return;
    try {
      await api(`/api/tasks/${id}`, { method: 'DELETE' });
      router.push('/history');
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    }
  }

  const active = isActiveStatus(task.status);
  const reasons = (JSON.parse(task.reviewReasons || '[]') as string[]) ?? [];
  const working = !!activeJob;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/history" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Article History
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900">{task.selectedTitle || task.keyword}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <Badge color={statusColor(task.status)}>{STATUS_LABEL[task.status]}</Badge>
            <span>{task.keyword}</span>
            <span>· {moduleName(task.moduleKey)}</span>
            {task.website && <span>· {task.website.name}</span>}
            {task.categoryName && <span>· {task.categoryName}</span>}
            <span>· {task.language}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {task.chatgptConversationUrl && (
            <a href={task.chatgptConversationUrl} target="_blank" rel="noreferrer">
              <Button size="sm" icon={<MessageSquare className="h-4 w-4" />}>
                ChatGPT chat
              </Button>
            </a>
          )}
          {task.wpEditUrl && (
            <a href={task.wpEditUrl} target="_blank" rel="noreferrer">
              <Button size="sm" icon={<ExternalLink className="h-4 w-4" />}>
                Open draft
              </Button>
            </a>
          )}
          <Button size="sm" icon={<Gauge className="h-4 w-4" />} onClick={() => action('seo-check')} loading={busy === 'seo-check'} disabled={!task.bodyHtml}>
            Run SEO check
          </Button>
          {task.website && task.bodyHtml && (
            <Button size="sm" variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => action('send-to-wordpress', {}, 'Sending to WordPress — the worker creates or updates the draft.')} loading={busy === 'send-to-wordpress'} disabled={working}>
              Send to WordPress
            </Button>
          )}
          {active && (
            <Button size="sm" icon={<Square className="h-4 w-4" />} onClick={() => action('cancel', {}, 'Cancelling…')} loading={busy === 'cancel'}>
              Cancel
            </Button>
          )}
          {!working && ['FAILED', 'CANCELLED', 'LOGIN_REQUIRED', 'NEEDS_REVIEW', 'DRAFT_CREATED'].includes(task.status) && (
            <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => action('retry', {}, 'Retrying from the last completed stage.')} loading={busy === 'retry'}>
              Retry
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>
            Delete
          </Button>
        </div>
      </div>

      {active && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-1.5 flex justify-between text-xs text-gray-600">
            <span>{task.statusMessage ?? STATUS_LABEL[task.status]}</span>
            <span>{task.progress}%</span>
          </div>
          <ProgressBar value={task.progress} />
        </div>
      )}
      {task.status === 'FAILED' && task.error && <Alert type="error" className="mb-4" title="Failed">{task.error}</Alert>}
      {task.status === 'LOGIN_REQUIRED' && (
        <Alert type="warning" className="mb-4" title={`Waiting for a ${task.loginRequiredFor === 'wordpress' ? 'WordPress' : 'ChatGPT'} login`}>
          {task.statusMessage} It continues by itself once the session works again.
        </Alert>
      )}
      {(task.status === 'NEEDS_REVIEW' || reasons.length > 0) && reasons.length > 0 && (
        <Alert type="warning" className="mb-4" title="Needs review">
          <ul className="list-disc pl-4">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alert>
      )}
      {notice && <Alert type={notice.type} className="mb-4">{notice.text}</Alert>}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'titles', label: 'Titles' },
          { value: 'editor', label: 'Editor' },
          { value: 'stages', label: 'Stages' },
          { value: 'logs', label: 'Logs', count: task._count.logs },
          { value: 'conversation', label: 'Conversation', count: task._count.responses },
        ]}
      />
      {tab === 'overview' && <OverviewTab task={task} />}
      {tab === 'titles' && <TitlesTab task={task} onApprove={(title) => action('approve-title', { title }, 'Title saved.')} busy={busy === 'approve-title'} />}
      {tab === 'editor' && <EditorTab task={task} onSaved={load} />}
      {tab === 'stages' && <StagesTab task={task} working={working} onRegenerate={(stageKey) => action('regenerate', { stageKey }, `Regenerating ${stageKey}.`)} />}
      {tab === 'logs' && <LogList taskId={task.id} compact autoRefresh={active} />}
      {tab === 'conversation' && <ConversationTab taskId={task.id} conversationUrl={task.chatgptConversationUrl} />}
    </div>
  );
}
