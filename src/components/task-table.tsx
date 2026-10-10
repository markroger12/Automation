'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, RotateCcw, Square, Trash2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { STATUS_LABEL, isActiveStatus, statusColor, type TaskStatusName } from '@/lib/status';
import { MODULES, moduleName } from '@/modules/registry';
import { Badge, Button, EmptyState, Input, ProgressBar, Select, Spinner, Table, Td, Th } from './ui';

export type TaskRow = {
  id: string;
  moduleKey: string;
  keyword: string;
  status: TaskStatusName;
  progress: number;
  statusMessage: string | null;
  currentStage: string | null;
  selectedTitle: string | null;
  seoScore: number | null;
  rankMathScore: number | null;
  wordCount: number | null;
  wpEditUrl: string | null;
  error: string | null;
  language: string;
  categoryName: string | null;
  createdAt: string;
  updatedAt: string;
  website: { id: string; name: string } | null;
  workflowKeyword: { id: string; publishAt: string | null; state: string } | null;
};

export function TaskTable({ view }: { view: 'queue' | 'all' }) {
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');
  const [moduleKey, setModuleKey] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const url = useCallback(
    (c?: string | null) => {
      const p = new URLSearchParams({ view, limit: '50' });
      if (status) p.set('status', status);
      if (moduleKey) p.set('module', moduleKey);
      if (q) p.set('q', q);
      if (c) p.set('cursor', c);
      return `/api/tasks?${p}`;
    },
    [view, status, moduleKey, q],
  );

  const load = useCallback(async () => {
    const r = await api<{ tasks: TaskRow[]; nextCursor: string | null; total: number }>(url());
    setRows(r.tasks);
    setCursor(r.nextCursor);
    setTotal(r.total);
  }, [url]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const t = setInterval(load, view === 'queue' ? 3000 : 10000);
    return () => clearInterval(t);
  }, [load, view]);

  async function more() {
    if (!cursor) return;
    const r = await api<{ tasks: TaskRow[]; nextCursor: string | null }>(url(cursor));
    setRows((x) => [...(x ?? []), ...r.tasks]);
    setCursor(r.nextCursor);
  }

  async function act(id: string, action: 'cancel' | 'retry') {
    await api(`/api/tasks/${id}/actions`, { body: { action } }).catch((e) => alert(e.message));
    load();
  }

  async function bulk(action: 'cancel' | 'retry' | 'delete') {
    if (!selected.size) return;
    if (action === 'delete' && !confirm(`Delete ${selected.size} article(s)? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await api<{ done: number; skipped: number }>('/api/tasks/bulk', { body: { ids: [...selected], action } });
      if (r.skipped) alert(`${r.done} done, ${r.skipped} skipped (running or not in a matching state).`);
      setSelected(new Set());
      load();
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder="Search keyword or title" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select className="w-48" value={moduleKey} onChange={(e) => setModuleKey(e.target.value)}>
          <option value="">All writers</option>
          {MODULES.filter((m) => m.group === 'Writers' && m.status === 'active').map((m) => (
            <option key={m.key} value={m.key}>
              {m.name}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={load}>
          Refresh
        </Button>
        <span className="text-xs text-gray-500">{total} article(s)</span>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-600">{selected.size} selected</span>
            <Button size="sm" icon={<Square className="h-3.5 w-3.5" />} onClick={() => bulk('cancel')} loading={busy}>
              Cancel
            </Button>
            <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => bulk('retry')} loading={busy}>
              Retry
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => bulk('delete')} loading={busy}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {!rows ? (
        <div className="py-8 text-center">
          <Spinner className="mx-auto" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={view === 'queue' ? 'The queue is empty' : 'No articles yet'}>Add keywords in one of the writers.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-8">
                <input type="checkbox" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
              </Th>
              <Th>Article</Th>
              <Th>Status</Th>
              <Th>Scores</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50">
                <Td>
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                </Td>
                <Td className="max-w-md">
                  <Link href={`/articles/${t.id}`} className="font-medium text-gray-900 hover:text-brand-700">
                    {t.selectedTitle || t.keyword}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-gray-500">
                    <span>{t.keyword}</span>
                    <span>· {moduleName(t.moduleKey)}</span>
                    {t.website && <span>· {t.website.name}</span>}
                    {t.categoryName && <span>· {t.categoryName}</span>}
                    {t.language === 'German' && <span>· DE</span>}
                    {t.workflowKeyword && <span>· workflow</span>}
                  </div>
                </Td>
                <Td className="w-64">
                  <Badge color={statusColor(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                  {isActiveStatus(t.status) && <ProgressBar value={t.progress} className="mt-1.5" />}
                  <div className="mt-1 line-clamp-2 text-xs text-gray-500" title={t.error ?? t.statusMessage ?? ''}>
                    {t.status === 'FAILED' ? t.error : t.statusMessage}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-xs">
                  {t.seoScore !== null && <div>SEO {t.seoScore}</div>}
                  {t.rankMathScore !== null && <div>Rank Math {t.rankMathScore}</div>}
                  {t.wordCount !== null && <div className="text-gray-500">{t.wordCount} words</div>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-gray-500">{new Date(t.createdAt).toLocaleString()}</Td>
                <Td className="whitespace-nowrap text-right">
                  {t.wpEditUrl && (
                    <a href={t.wpEditUrl} target="_blank" rel="noreferrer" title="Open draft" className="mr-1 inline-flex rounded p-1 text-gray-500 hover:bg-gray-100">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                  {isActiveStatus(t.status) && (
                    <button onClick={() => act(t.id, 'cancel')} title="Cancel" className="inline-flex rounded p-1 text-gray-500 hover:bg-gray-100">
                      <Square className="h-4 w-4" />
                    </button>
                  )}
                  {['FAILED', 'CANCELLED', 'LOGIN_REQUIRED'].includes(t.status) && (
                    <button onClick={() => act(t.id, 'retry')} title="Retry" className="inline-flex rounded p-1 text-gray-500 hover:bg-gray-100">
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {cursor && (
        <div className="mt-3 text-center">
          <Button size="sm" onClick={more}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
