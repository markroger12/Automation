'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe, Plus, ExternalLink } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { Alert, Badge, Button, EmptyState, Loading, PageHeader, Table, Td, Th } from '@/components/ui';
import { WebsiteForm, emptyWebsite, type WebsiteFormValue } from './website-form';
import { Modal } from '@/components/ui';
import { useRouter } from 'next/navigation';

type Row = {
  id: string;
  name: string;
  url: string;
  language: string;
  isActive: boolean;
  canPublish: boolean;
  profile: { sessionStatus: string; sessionDetail: string | null; lastCheckedAt: string | null } | null;
  _count: { categories: number; tasks: number };
  workflow: { isActive: boolean } | null;
};

export const SESSION_COLOR = { ACTIVE: 'green', LOGIN_REQUIRED: 'orange', ERROR: 'red', UNKNOWN: 'gray' } as const;

export function WebsitesView() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<WebsiteFormValue>(emptyWebsite());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<{ websites: Row[] }>('/api/websites').then((r) => setRows(r.websites)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ website: { id: string } }>('/api/websites', { body: form });
      setOpen(false);
      setForm(emptyWebsite());
      router.push(`/websites/${r.website.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Websites"
        icon={<Globe className="h-5 w-5" />}
        description="Each website has its own saved Chrome profile. Log in once by hand; the app never stores or types passwords."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Add website
          </Button>
        }
      />
      {error && !open && <Alert type="error" className="mb-4">{error}</Alert>}
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState title="No websites yet" icon={<Globe className="h-8 w-8" />}>
          Add your WordPress site, then press Login on its page and log in once in the window that opens.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Website</Th>
              <Th>Language</Th>
              <Th>Session</Th>
              <Th>Categories</Th>
              <Th>Articles</Th>
              <Th>Workflow</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((w) => (
              <tr key={w.id} className="hover:bg-gray-50">
                <Td>
                  <Link href={`/websites/${w.id}`} className="font-medium text-gray-900 hover:text-brand-700">
                    {w.name}
                  </Link>
                  <a href={w.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:underline">
                    {w.url.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
                  </a>
                  {!w.isActive && <Badge className="ml-2">inactive</Badge>}
                </Td>
                <Td>{w.language}</Td>
                <Td>
                  <Badge color={SESSION_COLOR[(w.profile?.sessionStatus ?? 'UNKNOWN') as keyof typeof SESSION_COLOR]} title={w.profile?.sessionDetail ?? undefined}>
                    {(w.profile?.sessionStatus ?? 'UNKNOWN').replace('_', ' ').toLowerCase()}
                  </Badge>
                </Td>
                <Td>{w._count.categories}</Td>
                <Td>{w._count.tasks}</Td>
                <Td>
                  <Link href={`/workflow?website=${w.id}`} title="Open the workflow">
                    {w.workflow?.isActive ? <Badge color="green">on</Badge> : <Badge>off</Badge>}
                  </Link>
                  {w.canPublish && <Badge color="yellow" className="ml-1">may publish</Badge>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add website"
        wide
        footer={
          <Button variant="primary" onClick={create} loading={busy}>
            Add website
          </Button>
        }
      >
        {error && <Alert type="error" className="mb-3">{error}</Alert>}
        <WebsiteForm value={form} onChange={setForm} />
      </Modal>
    </div>
  );
}
