'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ImageIcon, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { Badge, Button, Input, Select, Spinner, cn, type BadgeColor } from './ui';

export type LogRow = {
  id: string;
  taskId: string | null;
  keyword: string | null;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  category: string;
  stage: string | null;
  message: string;
  data: string | null;
  screenshotPath: string | null;
  createdAt: string;
};

const LEVEL_COLOR: Record<LogRow['level'], BadgeColor> = { DEBUG: 'gray', INFO: 'blue', WARN: 'yellow', ERROR: 'red' };

export function LogList({ taskId, compact, autoRefresh }: { taskId?: string; compact?: boolean; autoRefresh?: boolean }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const buildUrl = useCallback(
    (c?: string | null) => {
      const p = new URLSearchParams();
      if (taskId) p.set('taskId', taskId);
      if (level) p.set('minLevel', level);
      if (category) p.set('category', category);
      if (q) p.set('q', q);
      if (c) p.set('cursor', c);
      p.set('limit', '150');
      return `/api/logs?${p.toString()}`;
    },
    [taskId, level, category, q],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ logs: LogRow[]; nextCursor: string | null }>(buildUrl());
      setLogs(r.logs);
      setCursor(r.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  async function more() {
    if (!cursor) return;
    const r = await api<{ logs: LogRow[]; nextCursor: string | null }>(buildUrl(cursor));
    setLogs((l) => [...l, ...r.logs]);
    setCursor(r.nextCursor);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="w-36" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          <option value="INFO">Info and up</option>
          <option value="WARN">Warnings and errors</option>
          <option value="ERROR">Errors only</option>
        </Select>
        <Select className="w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {['SYSTEM', 'BROWSER', 'CHATGPT', 'WORDPRESS', 'RANKMATH', 'SEO', 'QUEUE', 'SESSION'].map((c) => (
            <option key={c} value={c}>
              {c.toLowerCase()}
            </option>
          ))}
        </Select>
        <Input className="w-56" placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" variant="ghost" icon={loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} onClick={load}>
          Refresh
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {logs.length === 0 && !loading && <div className="p-6 text-center text-sm text-gray-500">No log entries.</div>}
        <ul className="divide-y divide-gray-100">
          {logs.map((l) => (
            <LogItem key={l.id} log={l} compact={compact} showTask={!taskId} />
          ))}
        </ul>
      </div>
      {cursor && (
        <div className="mt-3 text-center">
          <Button size="sm" onClick={more}>
            Load older entries
          </Button>
        </div>
      )}
    </div>
  );
}

function LogItem({ log, compact, showTask }: { log: LogRow; compact?: boolean; showTask: boolean }) {
  const [open, setOpen] = useState(false);
  const hasMore = !!log.data || !!log.screenshotPath || log.message.length > 220;
  return (
    <li className={cn('px-3 py-2 text-sm', log.level === 'ERROR' && 'bg-red-50/40', log.level === 'WARN' && 'bg-amber-50/40')}>
      <div className="flex items-start gap-2">
        <button className={cn('mt-0.5 text-gray-400', !hasMore && 'invisible')} onClick={() => setOpen(!open)} aria-label="Details">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <span className="w-[8.5rem] shrink-0 font-mono text-xs leading-5 text-gray-500">{new Date(log.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        <Badge color={LEVEL_COLOR[log.level]} className="shrink-0">
          {log.level}
        </Badge>
        {!compact && <span className="w-24 shrink-0 text-xs leading-5 text-gray-500">{log.category.toLowerCase()}</span>}
        <div className="min-w-0 flex-1">
          <div className={cn('break-words text-gray-800', !open && 'line-clamp-2')}>
            {log.stage && <span className="mr-1 font-mono text-xs text-gray-500">[{log.stage}]</span>}
            {log.message}
            {log.screenshotPath && <ImageIcon className="ml-1 inline h-3.5 w-3.5 text-gray-400" />}
          </div>
          {showTask && log.taskId && (
            <Link href={`/articles/${log.taskId}`} className="text-xs text-brand-600 hover:underline">
              {log.keyword ?? log.taskId}
            </Link>
          )}
          {open && (
            <div className="mt-2 space-y-2">
              {log.data && <pre className="max-h-96 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-700">{prettyJson(log.data)}</pre>}
              {log.screenshotPath && (
                <a href={`/api/screenshots/${log.screenshotPath}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/screenshots/${log.screenshotPath}`} alt="Failure screenshot" className="max-h-80 rounded border border-gray-200" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
