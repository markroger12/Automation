'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Chrome, RotateCcw } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { Alert, Badge, Button, Card } from './ui';

type Status = {
  worker: { online: boolean };
  extension: { online: boolean; version: string | null; tabs: number; paused: boolean; connected: boolean; lastSeenAt: string | null };
  counts: { waitingChatgpt: number; activeChatgpt: number };
};

export function AutomationChromeControls() {
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api<Status>('/api/status').then(setStatus).catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function run(action: 'open' | 'restart') {
    setBusy(action);
    setMsg(null);
    try {
      const r = await api<{ message?: string }>('/api/automation-chrome', { body: { action } });
      setMsg({ type: 'success', text: r.message ?? (action === 'open' ? 'The worker is opening the Automation Chrome.' : 'The worker is restarting the Automation Chrome.') });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const ext = status?.extension;
  return (
    <Card
      title="Automation Chrome"
      description={
        <>
          A separate Chrome (data/chatgpt-chrome) where the extension works on chatgpt.com. Keep it open and the PC unlocked; never minimize it.{' '}
          <Link className="text-brand-600 underline" href="/automation-chrome">
            Setup steps
          </Link>
        </>
      }
      actions={
        <>
          <Button size="sm" icon={<Chrome className="h-4 w-4" />} onClick={() => run('open')} loading={busy === 'open'} disabled={!status?.worker.online}>
            Open
          </Button>
          <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => run('restart')} loading={busy === 'restart'} disabled={!status?.worker.online || (status?.counts.activeChatgpt ?? 0) > 0}>
            Restart
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {ext ? (
          <>
            <Badge color={ext.online ? 'green' : ext.connected ? 'yellow' : 'gray'}>{ext.online ? 'Extension online' : ext.connected ? 'Extension offline' : 'Not connected'}</Badge>
            {ext.version && <Badge>v{ext.version}</Badge>}
            {ext.online && <Badge color="blue">{ext.tabs} ChatGPT tab(s)</Badge>}
            {ext.paused && <Badge color="yellow">Automatic start paused</Badge>}
            <span className="text-gray-500">
              {status!.counts.activeChatgpt} prompt(s) running · {status!.counts.waitingChatgpt} waiting
            </span>
          </>
        ) : (
          <span className="text-gray-500">Loading…</span>
        )}
      </div>
      {!status?.worker.online && status && <Alert type="warning" className="mt-3">The worker is offline. Start it with npm run dev:all.</Alert>}
      {msg && (
        <Alert type={msg.type} className="mt-3">
          {msg.text}
        </Alert>
      )}
    </Card>
  );
}
