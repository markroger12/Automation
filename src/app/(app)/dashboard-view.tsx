'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, PenLine, CheckCircle2, AlertTriangle, XCircle, Activity } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { STATUS_LABEL, statusColor, type TaskStatusName } from '@/lib/status';
import { moduleName, WRITER_MODULES } from '@/modules/registry';
import { Alert, Badge, Button, Card, Loading, PageHeader, ProgressBar, Stat } from '@/components/ui';
import type { SystemStatus } from '@/server/status';

type TaskRow = {
  id: string;
  keyword: string;
  moduleKey: string;
  status: TaskStatusName;
  progress: number;
  statusMessage: string | null;
  selectedTitle: string | null;
  seoScore: number | null;
  rankMathScore: number | null;
  wpEditUrl: string | null;
  updatedAt: string;
  website: { name: string } | null;
};

type Dashboard = { total: number; week: number; byStatus: Record<string, number>; active: TaskRow[]; recent: TaskRow[]; system: SystemStatus };

export function DashboardView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<Dashboard>('/api/dashboard')
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) return error ? <Alert type="error">{error}</Alert> : <Loading />;
  const s = data.byStatus;
  const sys = data.system;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Dashboard"
        icon={<LayoutDashboard className="h-5 w-5" />}
        description="Queue keywords in a writer; the worker writes them with ChatGPT and saves WordPress drafts."
        actions={WRITER_MODULES.map((m) => (
          <Link key={m.key} href={m.href}>
            <Button size="sm" icon={<PenLine className="h-4 w-4" />}>
              {m.shortName ?? m.name}
            </Button>
          </Link>
        ))}
      />

      {!sys.worker.online && (
        <Alert type="error" title="The worker is offline">
          Nothing is written while it is stopped. Start everything with <code>npm run dev:all</code> (or <code>npm run start:all</code>).
        </Alert>
      )}
      {!sys.extension.connected && (
        <Alert type="warning" title="The ChatGPT Worker extension is not connected">
          Create a connection key in <Link href="/settings" className="underline">Settings</Link> and follow the <Link href="/automation-chrome" className="underline">Automation Chrome setup</Link>.
        </Alert>
      )}
      {sys.extension.connected && !sys.extension.online && sys.counts.waitingChatgpt > 0 && (
        <Alert type="warning" title={`${sys.counts.waitingChatgpt} ChatGPT prompt(s) are waiting`}>
          The Automation Chrome is not running. The worker opens it automatically; you can also open it from <Link href="/settings" className="underline">Settings</Link>.
        </Alert>
      )}
      {(s.LOGIN_REQUIRED ?? 0) > 0 && (
        <Alert type="warning" title={`${s.LOGIN_REQUIRED} article(s) wait for a login`}>
          Log in again (ChatGPT in the Automation Chrome, WordPress under <Link href="/websites" className="underline">Websites</Link>). They continue by themselves.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Articles" value={data.total} hint={`${data.week} this week`} icon={<Activity className="h-4 w-4" />} />
        <Stat label="Running" value={sys.counts.running} hint={`${sys.counts.queued} queued`} />
        <Stat label="Drafts" value={s.DRAFT_CREATED ?? 0} icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} />
        <Stat label="Needs review" value={s.NEEDS_REVIEW ?? 0} icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} />
        <Stat label="Failed" value={s.FAILED ?? 0} icon={<XCircle className="h-4 w-4 text-red-500" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="In progress" actions={<Link href="/queue" className="text-xs text-brand-600 hover:underline">Open queue</Link>}>
          <TaskList tasks={data.active} empty="Nothing is running." />
        </Card>
        <Card title="Recently finished" actions={<Link href="/history" className="text-xs text-brand-600 hover:underline">All articles</Link>}>
          <TaskList tasks={data.recent} empty="No finished articles yet." />
        </Card>
      </div>
    </div>
  );
}

function TaskList({ tasks, empty }: { tasks: TaskRow[]; empty: string }) {
  if (tasks.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <ul className="divide-y divide-gray-100">
      {tasks.map((t) => (
        <li key={t.id} className="py-2.5">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/articles/${t.id}`} className="min-w-0 truncate text-sm font-medium text-gray-900 hover:text-brand-700">
              {t.selectedTitle || t.keyword}
            </Link>
            <Badge color={statusColor(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <span>{moduleName(t.moduleKey)}</span>
            {t.website && <span>· {t.website.name}</span>}
            {t.seoScore !== null && <span>· SEO {t.seoScore}</span>}
            {t.rankMathScore !== null && <span>· Rank Math {t.rankMathScore}</span>}
          </div>
          {!['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'].includes(t.status) && (
            <div className="mt-1.5">
              <ProgressBar value={t.progress} />
              {t.statusMessage && <div className="mt-1 truncate text-xs text-gray-500">{t.statusMessage}</div>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
