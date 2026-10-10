'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, CalendarClock, ChevronsUp, Clock, ExternalLink, Plus, Save, SkipForward, Trash2, Undo2, Upload, X } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { useJob } from '@/lib/use-job';
import { KEYWORD_STATE_COLOR, STATUS_LABEL, statusColor, type TaskStatusName } from '@/lib/status';
import { formatInZone, formatPkt, from12h, nextSlots, to12h } from '@/core/workflow-time';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Loading, PageHeader, Select, Stat, Table, Tabs, Td, Textarea, Th, Toggle, cn } from '@/components/ui';

type WebsiteRow = {
  id: string;
  name: string;
  url: string;
  language: string;
  isActive: boolean;
  canPublish: boolean;
  siteTimezone: string | null;
  searchConsoleProperty: string | null;
  celebrityImages: boolean;
  tigramImages: boolean;
  profileId: string | null;
  defaultCategoryId: string | null;
  workflow?: { isActive: boolean } | null;
};

type Keyword = {
  id: string;
  keyword: string;
  title: string | null;
  secondaryKeywords: string;
  kind: 'UNKNOWN' | 'CELEBRITY' | 'TIGRAM';
  kindSource: string | null;
  kindNote: string | null;
  state: string;
  publishAt: string | null;
  publishedUrl: string | null;
  indexedAt: string | null;
  lastError: string | null;
  attempts: number;
  task: { id: string; status: TaskStatusName; statusMessage: string | null; selectedTitle: string | null; wpPostId: number | null; wpEditUrl: string | null; wpPostUrl: string | null } | null;
};

type Workflow = { id: string; isActive: boolean; publishTimes: string; days: string; writeAheadHours: number; images: 'on' | 'off' | null; indexAfterPublish: boolean; keywords: Keyword[] };

type Form = {
  isActive: boolean;
  publishTimes: string[];
  days: number[];
  writeAheadHours: number;
  images: 'on' | 'off' | null;
  indexAfterPublish: boolean;
  canPublish: boolean;
  searchConsoleProperty: string;
  siteTimezone: string;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATE_LABEL: Record<string, string> = {
  WAITING: 'Waiting',
  WRITING: 'Writing',
  READY: 'Draft ready',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  INDEXED: 'Indexing asked',
  DONE: 'Done',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};
type Filter = 'all' | 'waiting' | 'writing' | 'ready' | 'scheduled' | 'done' | 'problems';
const FILTERS: Record<Filter, string[] | null> = {
  all: null,
  waiting: ['WAITING'],
  writing: ['WRITING'],
  ready: ['READY'],
  scheduled: ['SCHEDULED'],
  done: ['PUBLISHED', 'INDEXED', 'DONE'],
  problems: ['FAILED', 'SKIPPED'],
};
const NOT_STARTED = ['WAITING', 'FAILED', 'SKIPPED'];

function parseList<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function toForm(wf: Workflow, w: WebsiteRow): Form {
  return {
    isActive: wf.isActive,
    publishTimes: parseList<string>(wf.publishTimes),
    days: parseList<number>(wf.days),
    writeAheadHours: wf.writeAheadHours,
    images: wf.images,
    indexAfterPublish: wf.indexAfterPublish,
    canPublish: w.canPublish,
    searchConsoleProperty: w.searchConsoleProperty ?? '',
    siteTimezone: w.siteTimezone ?? '',
  };
}

function siteTime(d: Date, tz: string | null): string {
  if (!tz) return '';
  const local = formatInZone(d, tz);
  const [date, time] = local.split('T');
  return `${date} ${to12h((time ?? '').slice(0, 5))}`;
}

export function WorkflowView({ isAdmin, initialWebsiteId }: { isAdmin: boolean; initialWebsiteId: string | null }) {
  const [websites, setWebsites] = useState<WebsiteRow[] | null>(null);
  const [websiteId, setWebsiteId] = useState<string>(initialWebsiteId ?? '');
  const [website, setWebsite] = useState<WebsiteRow | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info' | 'warning'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [timeText, setTimeText] = useState('');
  const [aheadMode, setAheadMode] = useState<'now' | 'hours'>('now');
  const [paste, setPaste] = useState('');
  const [pasteKind, setPasteKind] = useState<'' | 'CELEBRITY' | 'TIGRAM'>('');
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async (id: string) => {
    try {
      const r = await api<{ websites: WebsiteRow[]; workflow?: Workflow; website?: WebsiteRow }>(id ? `/api/workflows?websiteId=${encodeURIComponent(id)}` : '/api/workflows');
      setWebsites(r.websites);
      if (!id) {
        if (r.websites[0]) setWebsiteId(r.websites[0].id);
        return;
      }
      if (r.workflow && r.website) {
        setWorkflow(r.workflow);
        setWebsite(r.website);
        if (!dirtyRef.current) {
          const f = toForm(r.workflow, r.website);
          setForm(f);
          setAheadMode(f.writeAheadHours > 0 ? 'hours' : 'now');
        }
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setForm(null);
    setWorkflow(null);
    setDirty(false);
    dirtyRef.current = false;
    setNotice(null);
    void load(websiteId);
    if (!websiteId) return;
    try {
      window.history.replaceState(null, '', `/workflow?website=${encodeURIComponent(websiteId)}`);
    } catch {
      // ignore
    }
    const t = setInterval(() => void load(websiteId), 15_000);
    return () => clearInterval(t);
  }, [websiteId, load]);

  const { track, running: tzRunning } = useJob((j) => {
    if (j.status === 'FAILED') setNotice({ type: 'error', text: j.error ?? 'Could not read the time zone.' });
    else {
      const tz = (j.result as { timezone?: string | null } | null)?.timezone;
      if (tz) {
        setForm((f) => (f ? { ...f, siteTimezone: tz } : f));
        setNotice({ type: 'success', text: `WordPress time zone: ${tz}` });
      } else setNotice({ type: 'warning', text: 'WordPress did not show its time zone. Enter it by hand, for example Europe/Berlin or UTC+2.' });
    }
    void load(websiteId);
  });

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
  }

  const upcoming = useMemo(() => (form && form.publishTimes.length ? nextSlots(form.publishTimes, form.days, new Date(), 5, 60) : []), [form]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const k of workflow?.keywords ?? []) c[k.state] = (c[k.state] ?? 0) + 1;
    return c;
  }, [workflow]);

  const shown = useMemo(() => {
    const states = FILTERS[filter];
    return (workflow?.keywords ?? []).filter((k) => !states || states.includes(k.state));
  }, [workflow, filter]);

  if (!websites) return error ? <Alert type="error">{error}</Alert> : <Loading />;

  if (!websites.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workflow" icon={<CalendarClock className="h-6 w-6" />} description="Write articles on a schedule, one list of keywords per website." />
        <EmptyState title="No websites yet" icon={<CalendarClock className="h-8 w-8" />}>
          Add a website first. <Link className="text-brand-600 underline" href="/websites">Go to Websites</Link>
        </EmptyState>
      </div>
    );
  }

  function addTime() {
    const t = from12h(timeText);
    if (!t) {
      setNotice({ type: 'error', text: 'Write the time like 9:30 PM.' });
      return;
    }
    if (form && !form.publishTimes.includes(t)) set('publishTimes', [...form.publishTimes, t].sort());
    setTimeText('');
  }

  function toggleDay(d: number) {
    if (!form) return;
    const all = form.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : form.days;
    const next = all.includes(d) ? all.filter((x) => x !== d) : [...all, d].sort();
    set('days', next.length === 7 ? [] : next);
  }

  async function save() {
    if (!form || !website) return;
    setSaving(true);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        isActive: form.isActive,
        publishTimes: form.publishTimes,
        days: form.days,
        writeAheadHours: aheadMode === 'now' ? 0 : Math.max(1, Math.min(168, Math.round(form.writeAheadHours || 1))),
        images: form.images,
        indexAfterPublish: form.indexAfterPublish,
        searchConsoleProperty: form.searchConsoleProperty.trim() || null,
        siteTimezone: form.siteTimezone.trim() || null,
      };
      if (isAdmin) body.canPublish = form.canPublish;
      await api(`/api/workflows/${website.id}`, { method: 'PUT', body });
      setDirty(false);
      dirtyRef.current = false;
      await load(website.id);
      setNotice({ type: 'success', text: form.isActive ? 'Saved. The worker checks the workflow every minute.' : 'Saved. The workflow is off.' });
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function readTimezone() {
    if (!website) return;
    setNotice({ type: 'info', text: 'Reading the time zone from WordPress…' });
    try {
      const r = await api<{ jobId: string }>(`/api/websites/${website.id}/session`, { body: { action: 'detect-timezone' } });
      track(r.jobId);
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    }
  }

  async function addKeywords(body: { text?: string; csv?: string }) {
    if (!website) return;
    setAdding(true);
    setNotice(null);
    try {
      const r = await api<{ added: number; duplicates: string[] }>(`/api/workflows/${website.id}/keywords`, { body: { ...body, kind: pasteKind || undefined } });
      const dup = r.duplicates.length ? ` ${r.duplicates.length} already in the list (skipped): ${r.duplicates.slice(0, 5).join(', ')}${r.duplicates.length > 5 ? '…' : ''}` : '';
      setNotice({ type: r.added ? 'success' : 'warning', text: `Added ${r.added} keyword${r.added === 1 ? '' : 's'}.${dup}` });
      if (body.text) setPaste('');
      await load(website.id);
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    } finally {
      setAdding(false);
    }
  }

  async function onCsv(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setNotice({ type: 'error', text: 'That file is too big (2 MB at most).' });
      return;
    }
    await addKeywords({ csv: await file.text() });
    if (fileRef.current) fileRef.current.value = '';
  }

  async function patch(k: Keyword, body: Record<string, unknown>) {
    setBusyId(k.id);
    try {
      await api(`/api/workflow-keywords/${k.id}`, { method: 'PATCH', body });
      await load(websiteId);
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(k: Keyword) {
    if (!confirm(`Remove "${k.keyword}" from the list?${k.task ? ' Its article stays in the history.' : ''}`)) return;
    setBusyId(k.id);
    try {
      await api(`/api/workflow-keywords/${k.id}`, { method: 'DELETE' });
      await load(websiteId);
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  const undecided = (workflow?.keywords ?? []).filter((k) => k.kind === 'UNKNOWN' && k.state === 'WAITING');
  const needHand = undecided.filter((k) => k.kindSource);
  const ahead = (counts.WRITING ?? 0) + (counts.READY ?? 0);
  const imagesHelp = website ? `Celebrity articles: ${website.celebrityImages ? 'on' : 'off'}, Tigram articles: ${website.tigramImages ? 'on' : 'off'} (from the website settings).` : '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow"
        icon={<CalendarClock className="h-6 w-6" />}
        description="Add keywords once; articles are written and saved as drafts on a schedule. Times are Pakistan time."
        actions={
          <Select value={websiteId} onChange={(e) => setWebsiteId(e.target.value)} className="min-w-56" aria-label="Website">
            {websites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.workflow?.isActive ? ' — on' : ''}
              </option>
            ))}
          </Select>
        }
      />

      {notice && <Alert type={notice.type}>{notice.text}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      {!form || !workflow || !website ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Stat label="Waiting" value={counts.WAITING ?? 0} />
            <Stat label="Written ahead" value={`${ahead} / 10`} hint="Writing or ready, not published yet" />
            <Stat label="Scheduled" value={counts.SCHEDULED ?? 0} />
            <Stat label="Published" value={(counts.PUBLISHED ?? 0) + (counts.INDEXED ?? 0) + (counts.DONE ?? 0)} />
            <Stat label="Failed" value={counts.FAILED ?? 0} />
          </div>

          {!website.isActive && <Alert type="warning">This website is switched off, so nothing is written. Switch it on in Websites.</Alert>}
          {!website.profileId && <Alert type="warning">This website has no saved login yet. Log in on its Websites page so drafts can be saved.</Alert>}
          {needHand.length > 0 && (
            <Alert type="warning" title={`${needHand.length} keyword${needHand.length === 1 ? ' needs' : 's need'} a writer`}>
              The app could not tell if these are about a person. Choose Celebrity or Tigram in the list below; they wait until then.
            </Alert>
          )}

          <Card
            title="Schedule"
            actions={
              <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} loading={saving} disabled={!dirty}>
                Save
              </Button>
            }
          >
            <div className="space-y-6">
              <Toggle checked={form.isActive} onChange={(v) => set('isActive', v)} label="Workflow is on" help="When off, nothing new is written or scheduled. Articles already being written finish." />

              <div className="grid gap-6 lg:grid-cols-2">
                <Field label="Publish times (Pakistan time)" help="One article per time. Without times, articles are only written as drafts.">
                  <div className="flex flex-wrap gap-2">
                    {form.publishTimes.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-700">
                        {to12h(t)}
                        <button type="button" aria-label={`Remove ${to12h(t)}`} onClick={() => set('publishTimes', form.publishTimes.filter((x) => x !== t))} className="text-brand-500 hover:text-brand-800">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                    {!form.publishTimes.length && <span className="text-sm text-gray-500">No publish times yet.</span>}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={timeText}
                      onChange={(e) => setTimeText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTime();
                        }
                      }}
                      placeholder="9:30 PM"
                      className="max-w-36"
                    />
                    <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={addTime}>
                      Add time
                    </Button>
                  </div>
                </Field>

                <Field label="Days" help="All days are used when every day is ticked.">
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((d, i) => {
                      const on = form.days.length === 0 || form.days.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDay(i)}
                          className={cn('rounded-md border px-3 py-1.5 text-sm', on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-500')}
                          aria-pressed={on}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Start writing">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={aheadMode}
                      onChange={(e) => {
                        const m = e.target.value as 'now' | 'hours';
                        setAheadMode(m);
                        set('writeAheadHours', m === 'now' ? 0 : form.writeAheadHours || 12);
                      }}
                      className="max-w-80"
                    >
                      <option value="now">As soon as a keyword is added</option>
                      <option value="hours">Some hours before its publish time</option>
                    </Select>
                    {aheadMode === 'hours' && (
                      <>
                        <Input type="number" min={1} max={168} value={form.writeAheadHours} onChange={(e) => set('writeAheadHours', Number(e.target.value))} className="max-w-24" />
                        <span className="text-sm text-gray-600">hours before</span>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">At most 10 articles are written ahead of their publish time.</p>
                </Field>

                <Field label="Images" help={form.images === null ? imagesHelp : undefined}>
                  <Select value={form.images ?? ''} onChange={(e) => set('images', (e.target.value || null) as Form['images'])}>
                    <option value="">Follow the website settings</option>
                    <option value="on">Always add images</option>
                    <option value="off">No images</option>
                  </Select>
                </Field>
              </div>

              <div className="space-y-4 border-t border-gray-100 pt-5">
                <Toggle
                  checked={form.canPublish}
                  onChange={(v) => set('canPublish', v)}
                  disabled={!isAdmin}
                  label="This website may publish by itself"
                  help={isAdmin ? 'When on, finished drafts are scheduled in WordPress for their publish time.' : 'Only an admin can change this.'}
                />
                {form.canPublish ? (
                  <Alert type="warning">
                    Articles go live without anyone reading them first. Articles that need a review are scheduled too; check the list now and then. Everything else in the app stays a draft.
                  </Alert>
                ) : (
                  <p className="text-sm text-gray-500">Off: the workflow only saves drafts. You publish them yourself in WordPress.</p>
                )}

                <div className="grid gap-6 lg:grid-cols-2">
                  <Field label="WordPress time zone" help="Used to schedule posts at the right moment. Example: Europe/Berlin or UTC+2.">
                    <div className="flex gap-2">
                      <Input value={form.siteTimezone} onChange={(e) => set('siteTimezone', e.target.value)} placeholder="Europe/Berlin" />
                      <Button variant="secondary" className="shrink-0 whitespace-nowrap" icon={<Clock className="h-4 w-4" />} onClick={readTimezone} loading={tzRunning} disabled={!website.profileId}>
                        Read from WordPress
                      </Button>
                    </div>
                  </Field>
                  <div className="space-y-3">
                    <Toggle checked={form.indexAfterPublish} onChange={(v) => set('indexAfterPublish', v)} label="Ask Google to index it" help="After a post is live, the app opens Search Console in this website's browser profile and clicks Request indexing. Google allows about 10 a day." />
                    {form.indexAfterPublish && (
                      <Field label="Search Console property">
                        <Input value={form.searchConsoleProperty} onChange={(e) => set('searchConsoleProperty', e.target.value)} placeholder="sc-domain:example.com" />
                      </Field>
                    )}
                  </div>
                </div>
              </div>

              {upcoming.length > 0 && (
                <div className="rounded-md bg-gray-50 p-3 text-sm">
                  <div className="mb-1 font-medium text-gray-700">Next publish times</div>
                  <ul className="space-y-0.5 text-gray-600">
                    {upcoming.map((d) => (
                      <li key={d.toISOString()}>
                        {formatPkt(d)} Pakistan time
                        {form.siteTimezone && <span className="text-gray-400"> · {siteTime(d, form.siteTimezone)} on the website</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>

          <Card title="Add keywords" description="One keyword per line. Add secondary keywords and an example title after a | if you like. Columns pasted from Google Sheets work too.">
            <div className="space-y-3">
              <Textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'sydney sweeney net worth | sydney sweeney age, sydney sweeney height | Sydney Sweeney Net Worth 2026\nbest budget phones'} />
              <div className="flex flex-wrap items-center gap-3">
                <Select value={pasteKind} onChange={(e) => setPasteKind(e.target.value as typeof pasteKind)} className="max-w-72" aria-label="Writer">
                  <option value="">Decide the writer automatically</option>
                  <option value="CELEBRITY">All are about a person (Celebrity)</option>
                  <option value="TIGRAM">None are about a person (Tigram)</option>
                </Select>
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => addKeywords({ text: paste })} loading={adding} disabled={!paste.trim()}>
                  Add keywords
                </Button>
                <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={(e) => void onCsv(e.target.files?.[0])} />
                <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()} disabled={adding}>
                  Upload CSV
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                CSV columns: keyword, secondary keywords, title, kind (celebrity or tigram). Keywords already in the list are skipped. Celebrity keywords use the writer chosen in{' '}
                <Link href="/settings" className="underline">
                  Settings
                </Link>
                .
              </p>
            </div>
          </Card>

          <Card title={`Keywords (${workflow.keywords.length})`}>
            <div className="mb-4">
              <Tabs<Filter>
                value={filter}
                onChange={setFilter}
                tabs={[
                  { value: 'all', label: 'All', count: workflow.keywords.length },
                  { value: 'waiting', label: 'Waiting', count: counts.WAITING ?? 0 },
                  { value: 'writing', label: 'Writing', count: counts.WRITING ?? 0 },
                  { value: 'ready', label: 'Draft ready', count: counts.READY ?? 0 },
                  { value: 'scheduled', label: 'Scheduled', count: counts.SCHEDULED ?? 0 },
                  { value: 'done', label: 'Published', count: (counts.PUBLISHED ?? 0) + (counts.INDEXED ?? 0) + (counts.DONE ?? 0) },
                  { value: 'problems', label: 'Failed / skipped', count: (counts.FAILED ?? 0) + (counts.SKIPPED ?? 0) },
                ]}
              />
            </div>
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">No keywords here.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Keyword</Th>
                    <Th>Writer</Th>
                    <Th>State</Th>
                    <Th>Publish time</Th>
                    <Th>Article</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((k) => {
                    const secondary = parseList<string>(k.secondaryKeywords);
                    const editable = NOT_STARTED.includes(k.state) && !k.task;
                    const busy = busyId === k.id;
                    return (
                      <tr key={k.id} className="align-top">
                        <Td>
                          <div className="font-medium text-gray-900">{k.keyword}</div>
                          {k.title && <div className="text-xs text-gray-500">Title: {k.title}</div>}
                          {secondary.length > 0 && <div className="text-xs text-gray-400">{secondary.join(', ')}</div>}
                          {k.lastError && <div className="mt-1 max-w-md text-xs text-red-600">{k.lastError}</div>}
                        </Td>
                        <Td>
                          {editable ? (
                            <Select
                              value={k.kind === 'UNKNOWN' ? '' : k.kind}
                              onChange={(e) => e.target.value && void patch(k, { kind: e.target.value })}
                              disabled={busy}
                              className={cn('min-w-32 py-1', k.kind === 'UNKNOWN' && k.kindSource ? 'border-yellow-400' : '')}
                              title={k.kindNote ?? undefined}
                            >
                              <option value="">{k.kindSource ? 'Choose…' : 'Checking…'}</option>
                              <option value="CELEBRITY">Celebrity</option>
                              <option value="TIGRAM">Tigram</option>
                            </Select>
                          ) : (
                            <Badge color={k.kind === 'CELEBRITY' ? 'purple' : 'blue'} title={k.kindNote ?? undefined}>
                              {k.kind === 'CELEBRITY' ? 'Celebrity' : k.kind === 'TIGRAM' ? 'Tigram' : 'Unknown'}
                            </Badge>
                          )}
                          {k.kindNote && <div className="mt-1 max-w-48 truncate text-xs text-gray-400" title={k.kindNote}>{k.kindNote}</div>}
                        </Td>
                        <Td>
                          <Badge color={KEYWORD_STATE_COLOR[k.state] ?? 'gray'}>{STATE_LABEL[k.state] ?? k.state}</Badge>
                          {k.attempts > 1 && <div className="mt-1 text-xs text-gray-400">Try {k.attempts} of 3</div>}
                        </Td>
                        <Td className="whitespace-nowrap text-sm">
                          {k.publishAt ? (
                            <>
                              <div>{formatPkt(new Date(k.publishAt))}</div>
                              {website.siteTimezone && <div className="text-xs text-gray-400">{siteTime(new Date(k.publishAt), website.siteTimezone)} site</div>}
                            </>
                          ) : (
                            <span className="text-gray-400">{['PUBLISHED', 'INDEXED', 'DONE'].includes(k.state) ? '' : form.publishTimes.length ? 'Next free time' : 'Draft only'}</span>
                          )}
                        </Td>
                        <Td className="text-sm">
                          {k.task ? (
                            <div className="space-y-1">
                              <Link href={`/articles/${k.task.id}`} className="text-brand-600 hover:underline">
                                Open article
                              </Link>
                              <div>
                                <Badge color={statusColor(k.task.status)}>{STATUS_LABEL[k.task.status] ?? k.task.status}</Badge>
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                          {k.publishedUrl && (
                            <a href={k.publishedUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-green-700 hover:underline">
                              Live post <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </Td>
                        <Td className="text-right">
                          <div className="flex justify-end gap-1">
                            {k.state === 'WAITING' && (
                              <>
                                <Button size="sm" variant="ghost" title="Move to the top" aria-label="Move to the top" onClick={() => patch(k, { move: 'top' })} disabled={busy} icon={<ChevronsUp className="h-4 w-4" />} />
                                <Button size="sm" variant="ghost" title="Move up" aria-label="Move up" onClick={() => patch(k, { move: 'up' })} disabled={busy} icon={<ArrowUp className="h-4 w-4" />} />
                                <Button size="sm" variant="ghost" title="Move down" aria-label="Move down" onClick={() => patch(k, { move: 'down' })} disabled={busy} icon={<ArrowDown className="h-4 w-4" />} />
                              </>
                            )}
                            {['WAITING', 'WRITING', 'READY'].includes(k.state) && (
                              <Button size="sm" variant="ghost" title="Skip" aria-label="Skip" onClick={() => patch(k, { state: 'SKIPPED' })} disabled={busy} icon={<SkipForward className="h-4 w-4" />} />
                            )}
                            {(k.state === 'FAILED' || k.state === 'SKIPPED') && (
                              <Button size="sm" variant="ghost" title="Put back in line" aria-label="Put back in line" onClick={() => patch(k, { state: 'WAITING' })} disabled={busy} icon={<Undo2 className="h-4 w-4" />} />
                            )}
                            {k.state !== 'WRITING' && k.state !== 'SCHEDULED' && (
                              <Button size="sm" variant="ghost" title="Remove" aria-label="Remove" onClick={() => remove(k)} disabled={busy} icon={<Trash2 className="h-4 w-4 text-red-600" />} />
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
