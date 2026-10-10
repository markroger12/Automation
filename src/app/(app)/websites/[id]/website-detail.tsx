'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Globe, LogIn, RefreshCw, ShieldCheck, AppWindow, Eraser, Trash2, FolderSync, Save, Clock } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { useJob } from '@/lib/use-job';
import { Alert, Badge, Button, Card, Loading, PageHeader } from '@/components/ui';
import { WebsiteForm, type WebsiteFormValue } from '../website-form';
import { SESSION_COLOR } from '../websites-view';

type Website = WebsiteFormValue & {
  id: string;
  canPublish: boolean;
  profile: { id: string; directory: string; sessionStatus: keyof typeof SESSION_COLOR; sessionDetail: string | null; lastCheckedAt: string | null; lastLoginAt: string | null } | null;
  categories: { id: string; name: string; wpId: number | null; slug: string | null }[];
};

const ACTION_LABEL: Record<string, string> = {
  login: 'Login window is open — log in, then close the window.',
  test: 'Testing the session…',
  refresh: 'Refreshing the session and categories…',
  open: 'Browser window is open — close it when you are done.',
  reset: 'Clearing the session…',
  'delete-profile': 'Deleting the profile folder…',
  'sync-categories': 'Reading categories from WordPress…',
  'detect-timezone': 'Reading the time zone from WordPress…',
};

function toForm(w: Website): WebsiteFormValue {
  return {
    name: w.name,
    url: w.url,
    adminUrl: w.adminUrl ?? '',
    editorType: w.editorType,
    language: w.language,
    targetCountry: w.targetCountry ?? '',
    isActive: w.isActive,
    celebrityImages: w.celebrityImages,
    tigramImages: w.tigramImages,
    internalLinkText: w.internalLinkText,
    defaultCategoryId: w.defaultCategoryId ?? '',
    searchConsoleProperty: w.searchConsoleProperty ?? '',
    siteTimezone: w.siteTimezone ?? '',
  };
}

export function WebsiteDetail({ id }: { id: string }) {
  const router = useRouter();
  const [website, setWebsite] = useState<Website | null>(null);
  const [form, setForm] = useState<WebsiteFormValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ website: Website }>(`/api/websites/${id}`)
        .then((r) => {
          setWebsite(r.website);
          setForm((f) => f ?? toForm(r.website));
        })
        .catch((e) => setError(e.message)),
    [id],
  );

  const { job, track, running } = useJob((j) => {
    load();
    if (j.status === 'FAILED') setNotice({ type: 'error', text: j.error ?? 'Failed.' });
    else {
      const r = j.result as { detail?: string; categories?: { count: number; added: number } | null; timezone?: string | null } | null;
      const parts = [r?.detail, r?.categories ? `${r.categories.count} categories (${r.categories.added} new).` : null, r?.timezone ? `Time zone: ${r.timezone}` : null].filter(Boolean);
      setNotice({ type: 'success', text: parts.join(' ') || 'Done.' });
    }
  });

  useEffect(() => {
    load();
  }, [load]);

  if (!website || !form) return error ? <Alert type="error">{error}</Alert> : <Loading />;

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const r = await api<{ website: Website }>(`/api/websites/${id}`, { method: 'PUT', body: { ...form, defaultCategoryId: form!.defaultCategoryId || null } });
      setForm(toForm({ ...website!, ...r.website }));
      await load();
      setNotice({ type: 'success', text: 'Website saved.' });
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function run(a: string) {
    if (a === 'delete-profile' && !confirm('Delete the saved browser profile (cookies and login) of this website?')) return;
    if (a === 'reset' && !confirm('Log this website out (clear its cookies)?')) return;
    setNotice({ type: 'info', text: ACTION_LABEL[a] ?? 'Working…' });
    setAction(a);
    try {
      const r = await api<{ jobId: string }>(`/api/websites/${id}/session`, { body: { action: a } });
      track(r.jobId);
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    }
  }

  async function remove() {
    if (!confirm(`Delete the website ${website!.name}? Its articles stay in the history.`)) return;
    try {
      await api(`/api/websites/${id}`, { method: 'DELETE' });
      router.push('/websites');
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    }
  }

  const p = website.profile;
  const busy = (a: string) => running && action === a;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/websites" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Websites
      </Link>
      <PageHeader
        title={website.name}
        icon={<Globe className="h-5 w-5" />}
        description={website.url}
        actions={
          <>
            <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>
              Delete website
            </Button>
            <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      />
      {notice && (
        <Alert type={notice.type === 'info' ? 'info' : notice.type}>
          {notice.text}
          {running && job && <span className="ml-1 text-xs opacity-70">({job.status.toLowerCase()})</span>}
        </Alert>
      )}

      <Card
        title="WordPress session"
        description="Login opens a visible Chrome window with this website's own profile. Log in and close the window; the cookies stay in data/profiles."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge color={SESSION_COLOR[p?.sessionStatus ?? 'UNKNOWN']}>{(p?.sessionStatus ?? 'UNKNOWN').replace('_', ' ').toLowerCase()}</Badge>
          {p?.sessionDetail && <span className="text-gray-600">{p.sessionDetail}</span>}
          {p?.lastCheckedAt && <span className="text-xs text-gray-400">checked {new Date(p.lastCheckedAt).toLocaleString()}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={<LogIn className="h-4 w-4" />} onClick={() => run('login')} loading={busy('login')} disabled={running}>
            Login
          </Button>
          <Button size="sm" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => run('test')} loading={busy('test')} disabled={running}>
            Test Session
          </Button>
          <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => run('refresh')} loading={busy('refresh')} disabled={running}>
            Refresh Session
          </Button>
          <Button size="sm" icon={<AppWindow className="h-4 w-4" />} onClick={() => run('open')} loading={busy('open')} disabled={running}>
            Open Browser
          </Button>
          <Button size="sm" icon={<FolderSync className="h-4 w-4" />} onClick={() => run('sync-categories')} loading={busy('sync-categories')} disabled={running}>
            Sync Categories
          </Button>
          <Button size="sm" icon={<Clock className="h-4 w-4" />} onClick={() => run('detect-timezone')} loading={busy('detect-timezone')} disabled={running}>
            Read time zone
          </Button>
          <Button size="sm" icon={<Eraser className="h-4 w-4" />} onClick={() => run('reset')} loading={busy('reset')} disabled={running}>
            Reset Session
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => run('delete-profile')} loading={busy('delete-profile')} disabled={running}>
            Delete Profile
          </Button>
        </div>
      </Card>

      <Card title="Settings">
        <WebsiteForm value={form} onChange={setForm} categories={website.categories} />
      </Card>

      <Card title={`Categories (${website.categories.length})`} description="Read from WordPress after login. Every article gets exactly one of these.">
        {website.categories.length === 0 ? (
          <p className="text-sm text-gray-500">No categories yet. Log in, then press Sync Categories.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {website.categories.map((c) => (
              <Badge key={c.id} color={c.id === website.defaultCategoryId ? 'blue' : 'gray'} title={c.slug ?? undefined}>
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
