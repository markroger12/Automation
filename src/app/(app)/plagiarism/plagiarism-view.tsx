'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink, Play, ScanSearch } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { useJob } from '@/lib/use-job';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Tabs, Textarea, Toggle, type BadgeColor } from '@/components/ui';

type DiffWord = { t: string; same: boolean };
type Passage = {
  kind: 'exact' | 'close';
  words: number;
  similarity: number;
  counted: boolean;
  why?: 'quoted' | 'boilerplate';
  articleStart: number;
  articleEnd: number;
  articleText: string;
  sourceText: string;
  sourceBefore: string;
  sourceAfter: string;
  articleDiff?: DiffWord[];
  sourceDiff?: DiffWord[];
};
type SourceKind = 'own' | 'linked' | 'url' | 'wikipedia' | 'google';
type SourceReport = { kind: SourceKind; title: string; url: string; passages: Passage[]; countedWords: number; shownWords: number };
type Report = {
  articleText: string;
  articleWords: number;
  sources: SourceReport[];
  checked: Record<SourceKind, number>;
  problems: { kind: SourceKind; url: string; reason: string }[];
  phrases: string[];
  googleSearches: number;
  countedWords: number;
  shownWords: number;
  ownArticles: number;
  boilerplate: number;
  finishedAt: string;
};
type TaskOption = { id: string; keyword: string; selectedTitle: string | null };

const KIND_LABEL: Record<SourceKind, string> = { own: 'Your article', linked: 'Linked page', url: 'Added page', wikipedia: 'Wikipedia', google: 'Google result' };
const KIND_COLOR: Record<SourceKind, BadgeColor> = { own: 'purple', linked: 'blue', url: 'blue', wikipedia: 'gray', google: 'yellow' };

function safeHref(url: string): string | null {
  if (url.startsWith('/articles/')) return url;
  return /^https?:\/\//i.test(url) ? url : null;
}

function Words({ words, mark }: { words: DiffWord[]; mark: string }) {
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className={w.same ? mark : 'font-medium text-gray-900 underline decoration-dotted'}>{w.t}</span>
        </Fragment>
      ))}
    </>
  );
}

function PassageRow({ p }: { p: Passage }) {
  const mark = p.counted ? 'bg-red-100 text-red-900' : 'bg-gray-100 text-gray-700';
  return (
    <div className="rounded-md border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs">
        {p.kind === 'exact' ? <Badge color={p.counted ? 'red' : 'gray'}>Same words · {p.words}</Badge> : <Badge color={p.counted ? 'yellow' : 'gray'}>Reworded sentence · {Math.round(p.similarity * 100)}% of words in place</Badge>}
        {!p.counted && <span className="text-gray-500">{p.why === 'quoted' ? 'In quotation marks — not counted' : 'Boilerplate you use in many articles — not counted'}</span>}
      </div>
      <div className="grid gap-px bg-gray-100 md:grid-cols-2">
        <div className="bg-white p-3 text-sm leading-relaxed text-gray-700">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Your article</div>
          {p.articleDiff ? <Words words={p.articleDiff} mark={mark} /> : <span className={mark}>{p.articleText}</span>}
        </div>
        <div className="bg-white p-3 text-sm leading-relaxed text-gray-700">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Source</div>
          <span className="text-gray-400">{p.sourceBefore ? `…${p.sourceBefore}` : ''}</span>
          {p.sourceDiff ? <Words words={p.sourceDiff} mark={mark} /> : <span className={mark}>{p.sourceText}</span>}
          <span className="text-gray-400">{p.sourceAfter ? `${p.sourceAfter}…` : ''}</span>
        </div>
      </div>
    </div>
  );
}

function SourceCard({ s, open, onToggle }: { s: SourceReport; open: boolean; onToggle: () => void }) {
  const counted = s.passages.filter((p) => p.counted).length;
  const href = safeHref(s.url);
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
          <Badge color={KIND_COLOR[s.kind]}>{KIND_LABEL[s.kind]}</Badge>
          <span className="truncate text-sm font-medium text-gray-900" title={s.title}>
            {s.title}
          </span>
        </button>
        <span className="text-xs text-gray-500">
          {counted} counted passage{counted === 1 ? '' : 's'} · {s.countedWords} words
          {s.passages.length > counted && ` · ${s.passages.length - counted} not counted`}
        </span>
        {href &&
          (href.startsWith('/') ? (
            <Link href={href} className="text-xs text-brand-600 hover:underline">
              Open
            </Link>
          ) : (
            <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
              Open <ExternalLink className="h-3 w-3" />
            </a>
          ))}
      </div>
      {open && (
        <div className="space-y-2 border-t border-gray-100 p-3">
          {s.passages.map((p, i) => (
            <PassageRow key={i} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The article with every matched passage marked. */
function ArticleMarks({ report }: { report: Report }) {
  const parts = useMemo(() => {
    const text = report.articleText;
    const marks = new Array<0 | 1 | 2>(text.length).fill(0);
    for (const s of report.sources)
      for (const p of s.passages)
        for (let i = p.articleStart; i < p.articleEnd; i++) {
          const v = p.counted ? 2 : 1;
          if (v > marks[i]!) marks[i] = v;
        }
    const out: { text: string; mark: 0 | 1 | 2 }[] = [];
    let start = 0;
    for (let i = 1; i <= text.length; i++) {
      if (i === text.length || marks[i] !== marks[start]) {
        out.push({ text: text.slice(start, i), mark: marks[start]! });
        start = i;
      }
    }
    return out;
  }, [report]);
  return (
    <div className="whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-700">
      {parts.map((p, i) => (
        <span key={i} className={p.mark === 2 ? 'bg-red-100 text-red-900' : p.mark === 1 ? 'bg-gray-200' : undefined}>
          {p.text}
        </span>
      ))}
    </div>
  );
}

export function PlagiarismView({ initialTaskId }: { initialTaskId: string | null }) {
  const [source, setSource] = useState<'article' | 'paste'>('article');
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [taskId, setTaskId] = useState(initialTaskId ?? '');
  const [text, setText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [language, setLanguage] = useState<'English' | 'German'>('English');
  const [urls, setUrls] = useState('');
  const [own, setOwn] = useState(true);
  const [links, setLinks] = useState(true);
  const [wikipedia, setWikipedia] = useState(true);
  const [google, setGoogle] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [view, setView] = useState<'sources' | 'article'>('sources');
  const [open, setOpen] = useState<Set<number>>(new Set([0]));
  const { job, track, running } = useJob((j) => {
    if (j.status === 'COMPLETED') {
      setReport(j.result as Report);
      setLastAt(null);
      setOpen(new Set([0]));
    } else setError(j.error ?? 'The check failed.');
  });

  useEffect(() => {
    api<{ tasks: TaskOption[] }>('/api/tasks?limit=100').then((r) => {
      setTasks(r.tasks);
      setTaskId((cur) => cur || r.tasks[0]?.id || '');
    });
    api<{ googleAvailable: boolean }>('/api/plagiarism').then((r) => setGoogleAvailable(r.googleAvailable));
  }, []);

  // Show the last check of the chosen article.
  useEffect(() => {
    if (source !== 'article' || !taskId) return;
    let stop = false;
    api<{ last: { finishedAt: string; report: Report | null } | null }>(`/api/plagiarism?taskId=${encodeURIComponent(taskId)}`)
      .then((r) => {
        if (stop || running) return;
        setReport(r.last?.report ?? null);
        setLastAt(r.last?.finishedAt ?? null);
        setOpen(new Set([0]));
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [taskId, source]);

  async function run() {
    setError(null);
    setReport(null);
    const list = urls
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (list.length > 10) {
      setError('Add at most 10 addresses.');
      return;
    }
    try {
      const sources = { own, links, wikipedia, google: google && googleAvailable };
      const r = await api<{ jobId: string }>('/api/plagiarism', {
        body: source === 'article' ? { taskId, urls: list, sources } : { text, keyword, language, urls: list, sources },
      });
      track(r.jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const step = (job?.progress as { step?: string } | null)?.step;
  const counted = report ? report.sources.reduce((n, s) => n + s.passages.filter((p) => p.counted).length, 0) : 0;
  const countedSources = report ? report.sources.filter((s) => s.passages.some((p) => p.counted)).length : 0;
  const notCounted = report ? report.sources.reduce((n, s) => n + s.passages.filter((p) => !p.counted).length, 0) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title="Plagiarism Check"
        icon={<ScanSearch className="h-5 w-5" />}
        description="Finds passages your article shares with other pages and shows them side by side. You read the evidence and decide; there is no score."
      />
      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        <Card title="Input">
          <Tabs<'article' | 'paste'>
            value={source}
            onChange={setSource}
            tabs={[
              { value: 'article', label: 'Saved article' },
              { value: 'paste', label: 'Paste HTML or text' },
            ]}
          />
          <div className="space-y-4">
            {source === 'article' ? (
              <Field label="Article">
                <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.selectedTitle || t.keyword}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <>
                <Field label="Text or HTML" help="Separate paragraphs with an empty line. Lines starting with > are quotes.">
                  <Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Topic (for Wikipedia)">
                    <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Sydney Sweeney" />
                  </Field>
                  <Field label="Language">
                    <Select value={language} onChange={(e) => setLanguage(e.target.value as 'English' | 'German')}>
                      <option>English</option>
                      <option>German</option>
                    </Select>
                  </Field>
                </div>
              </>
            )}
            <div className="space-y-3">
              <div className="text-sm font-medium text-gray-800">Compare with</div>
              <Toggle checked={own} onChange={setOwn} label="Your other articles" help="Also used to recognise wording you repeat in many articles." />
              <Toggle checked={links} onChange={setLinks} label="Pages the article links to" help="At most 10; links to your own websites are skipped." />
              <Toggle checked={wikipedia} onChange={setWikipedia} label="Wikipedia" help="The top 3 articles for the topic." />
              <Toggle
                checked={google && googleAvailable}
                onChange={setGoogle}
                disabled={!googleAvailable}
                label="Google results (serper.dev)"
                help={googleAvailable ? 'Searches 10 distinctive phrases (10 credits) and reads the top 12 pages.' : 'Add SERPER_API_KEY to the .env file and restart the app to use this.'}
              />
            </div>
            <Field label="More pages to compare" help="Up to 10 addresses, one per line.">
              <Textarea rows={3} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://example.com/some-article" />
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={run} loading={running} disabled={source === 'article' ? !taskId : !text.trim()}>
                Check
              </Button>
            </div>
            {running && <p className="text-xs text-gray-500">{step ? `${step}…` : 'Waiting for the worker…'}</p>}
            {error && <Alert type="error">{error}</Alert>}
          </div>
        </Card>

        <Card
          title="Evidence"
          description={report ? `Checked ${new Date(report.finishedAt).toLocaleString()}${lastAt ? ' (last check of this article)' : ''}` : 'Matching passages, side by side with their source.'}
        >
          {!report ? (
            <p className="text-sm text-gray-500">Run a check to see the passages.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                {counted ? (
                  <p>
                    <strong>{counted}</strong> passage{counted === 1 ? '' : 's'} from <strong>{countedSources}</strong> source{countedSources === 1 ? '' : 's'} share wording with this article ({report.countedWords} of its {report.articleWords} words).
                  </p>
                ) : (
                  <p>No shared passages were found in the sources that were checked.</p>
                )}
                {notCounted > 0 && <p className="mt-1 text-gray-500">{notCounted} more are shown but not counted: quotations, or wording you use in many of your own articles.</p>}
                <p className="mt-2 text-xs text-gray-500">
                  Checked: {report.checked.own} of your articles · {report.checked.linked} linked pages · {report.checked.url} added pages · {report.checked.wikipedia} Wikipedia articles
                  {report.googleSearches > 0 && ` · ${report.checked.google} Google results from ${report.googleSearches} searches`}. Exact runs need 8+ words; reworded sentences need 80% of their words in place.
                </p>
              </div>

              {report.sources.length > 0 && (
                <>
                  <Tabs<'sources' | 'article'>
                    value={view}
                    onChange={setView}
                    tabs={[
                      { value: 'sources', label: 'By source', count: report.sources.length },
                      { value: 'article', label: 'In the article' },
                    ]}
                  />
                  {view === 'sources' ? (
                    <div className="space-y-2">
                      {report.sources.map((s, i) => (
                        <SourceCard
                          key={`${s.url}-${i}`}
                          s={s}
                          open={open.has(i)}
                          onToggle={() =>
                            setOpen((o) => {
                              const n = new Set(o);
                              if (n.has(i)) n.delete(i);
                              else n.add(i);
                              return n;
                            })
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500">
                        <span className="bg-red-100 px-1 text-red-900">Counted</span> <span className="bg-gray-200 px-1">Shown, not counted</span>
                      </p>
                      <ArticleMarks report={report} />
                    </>
                  )}
                </>
              )}

              {report.phrases.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-600">Phrases searched on Google ({report.phrases.length})</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
                    {report.phrases.map((p) => (
                      <li key={p}>“{p}”</li>
                    ))}
                  </ul>
                </details>
              )}
              {report.problems.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-600">Could not read {report.problems.length} source{report.problems.length === 1 ? '' : 's'}</summary>
                  <ul className="mt-2 space-y-1 text-xs text-gray-600">
                    {report.problems.map((p, i) => (
                      <li key={i} className="break-all">
                        <Badge color={KIND_COLOR[p.kind]}>{KIND_LABEL[p.kind]}</Badge> {p.url} — {p.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
