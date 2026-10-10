'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { Send, Upload } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { getModule } from '@/modules/registry';
import { parseKeywordLines, type TaskInput } from '@/lib/task-input';
import type { Settings } from '@/lib/settings-schema';
import { ModuleIcon } from '@/components/icons';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select, Tabs, Textarea, Table, Th, Td } from '@/components/ui';

type Site = { id: string; name: string; language: string; targetCountry: string | null; defaultCategoryId: string | null; isActive: boolean; categories: { id: string; name: string }[] };
type Mode = 'single' | 'multiple' | 'csv';

export function WriterForm({ moduleKey }: { moduleKey: string }) {
  const mod = getModule(moduleKey)!;
  const [sites, setSites] = useState<Site[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>('single');
  const [websiteId, setWebsiteId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [language, setLanguage] = useState<'English' | 'German'>('English');
  const [country, setCountry] = useState('');
  const [keyword, setKeyword] = useState('');
  const [exampleTitle, setExampleTitle] = useState('');
  const [secondary, setSecondary] = useState('');
  const [lines, setLines] = useState('');
  const [csvRows, setCsvRows] = useState<TaskInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    Promise.all([api<{ websites: Site[] }>('/api/websites?withCategories=1'), api<{ settings: Settings }>('/api/settings')]).then(([w, s]) => {
      const active = w.websites.filter((x) => x.isActive);
      setSites(active);
      setSettings(s.settings);
      setLanguage(s.settings.defaultLanguage);
      setCountry(s.settings.targetCountry);
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(`writer-site-${moduleKey}`) : null;
      const first = active.find((x) => x.id === saved) ?? active[0];
      if (first) pickSite(first, s.settings);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey]);

  function pickSite(site: Site | undefined, s = settings) {
    setWebsiteId(site?.id ?? '');
    setCategoryId(site?.defaultCategoryId ?? '');
    if (site) {
      const lang = site.language === 'German' ? 'German' : 'English';
      setLanguage(lang);
      setCountry(site.targetCountry || (lang === 'German' ? 'Germany' : s?.targetCountry ?? 'United States'));
      try {
        window.localStorage.setItem(`writer-site-${moduleKey}`, site.id);
      } catch {
        // storage unavailable
      }
    }
  }

  const site = sites?.find((s) => s.id === websiteId);
  const parsedLines = useMemo(() => parseKeywordLines(lines), [lines]);

  function common() {
    return { moduleKey, websiteId: websiteId || null, categoryId: categoryId || null, language, targetCountry: country || null };
  }

  function onCsv(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (res) => {
        const rows: TaskInput[] = [];
        for (const r of res.data) {
          const kw = (r.keyword ?? r.keywords ?? r.primary_keyword ?? '').trim();
          if (kw.length < 2) continue;
          const cat = site?.categories.find((c) => c.name.toLowerCase() === (r.category ?? '').trim().toLowerCase());
          rows.push({
            ...common(),
            keyword: kw,
            exampleTitle: (r.example_title ?? r.title ?? '').trim() || null,
            secondaryKeywords: (r.secondary_keywords ?? r.secondary ?? '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean),
            categoryId: cat?.id ?? (categoryId || null),
            language: /^(german|deutsch|de)$/i.test(r.language ?? '') ? 'German' : /^(english|en)$/i.test(r.language ?? '') ? 'English' : language,
            targetCountry: (r.country ?? '').trim() || country || null,
          });
        }
        setCsvRows(rows);
        setResult(rows.length ? null : { type: 'error', text: 'No rows with a "keyword" column were found.' });
      },
    });
  }

  async function submit() {
    let tasks: TaskInput[] = [];
    if (mode === 'single') {
      if (keyword.trim().length < 2) return setResult({ type: 'error', text: 'Enter a keyword.' });
      tasks = [{ ...common(), keyword: keyword.trim(), exampleTitle: exampleTitle.trim() || null, secondaryKeywords: secondary.split(',').map((s) => s.trim()).filter(Boolean) }];
    } else if (mode === 'multiple') {
      tasks = parsedLines.map((l) => ({ ...common(), keyword: l.keyword, secondaryKeywords: l.secondaryKeywords, exampleTitle: l.exampleTitle ?? null }));
    } else tasks = csvRows;
    if (!tasks.length) return setResult({ type: 'error', text: 'Nothing to add.' });
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ created: number }>('/api/tasks', { body: { tasks } });
      setResult({ type: 'success', text: `${r.created} article(s) added to the queue.` });
      setKeyword('');
      setExampleTitle('');
      setSecondary('');
      setLines('');
      setCsvRows([]);
    } catch (e) {
      setResult({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!sites || !settings) return <Loading />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={mod.name} icon={<ModuleIcon name={mod.icon} className="h-5 w-5" />} description={mod.description} />
      {sites.length === 0 && (
        <Alert type="warning" className="mb-4" title="No website yet">
          Articles can be written without a website, but they are only saved as WordPress drafts when you <Link href="/websites" className="underline">add a website</Link>.
        </Alert>
      )}
      <Card>
        <Tabs<Mode>
          value={mode}
          onChange={setMode}
          tabs={[
            { value: 'single', label: 'One keyword' },
            { value: 'multiple', label: 'Multiple keywords', count: parsedLines.length || undefined },
            { value: 'csv', label: 'CSV import', count: csvRows.length || undefined },
          ]}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Website">
            <Select value={websiteId} onChange={(e) => pickSite(sites.find((s) => s.id === e.target.value))}>
              <option value="">— no website (do not send to WordPress) —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" help={site && site.categories.length === 0 ? 'No categories yet: log in and Sync Categories on the website page.' : mod.kind === 'tigram' ? 'Empty = ChatGPT picks one of the website’s categories.' : undefined}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!site}>
              <option value="">{mod.kind === 'tigram' ? '— let ChatGPT pick —' : '— website default —'}</option>
              {site?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value as 'English' | 'German')}>
              <option>English</option>
              <option>German</option>
            </Select>
          </Field>
          <Field label="Target country">
            <Input value={country} onChange={(e) => setCountry(e.target.value)} />
          </Field>
        </div>

        <div className="mt-5 border-t border-gray-100 pt-5">
          {mode === 'single' && (
            <div className="grid gap-4">
              <Field label={mod.kind === 'celebrity' ? 'Keyword (the person)' : 'Keyword'}>
                <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={mod.kind === 'celebrity' ? 'Sydney Sweeney' : 'best vpn for gaming'} autoFocus />
              </Field>
              {mod.form?.exampleTitle !== false && (
                <Field label="Example title (optional)">
                  <Input value={exampleTitle} onChange={(e) => setExampleTitle(e.target.value)} />
                </Field>
              )}
              {mod.form?.secondaryKeywords !== false && (
                <Field label="Secondary keywords (optional)" help="Comma separated">
                  <Input value={secondary} onChange={(e) => setSecondary(e.target.value)} />
                </Field>
              )}
            </div>
          )}
          {mode === 'multiple' && (
            <Field label="One article per line" help={mod.form?.secondaryKeywords === false ? 'keyword' : 'keyword | secondary1, secondary2 | example title (optional parts)'}>
              <Textarea rows={12} className="font-mono text-xs" value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'Sydney Sweeney | sydney sweeney age, sydney sweeney height\nJacob Elordi'} />
            </Field>
          )}
          {mode === 'csv' && (
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-600 hover:bg-gray-50">
                <Upload className="h-4 w-4" />
                <span>Choose a CSV file with the columns keyword, example_title (or title), secondary_keywords, category, country, language</span>
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
              </label>
              {csvRows.length > 0 && (
                <Table className="max-h-80 overflow-y-auto">
                  <thead>
                    <tr>
                      <Th>Keyword</Th>
                      <Th>Title</Th>
                      <Th>Secondary</Th>
                      <Th>Language</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {csvRows.slice(0, 200).map((r, i) => (
                      <tr key={i}>
                        <Td>{r.keyword}</Td>
                        <Td>{r.exampleTitle}</Td>
                        <Td>{r.secondaryKeywords.join(', ')}</Td>
                        <Td>{r.language}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          )}
        </div>

        {result && (
          <Alert type={result.type} className="mt-4">
            {result.text}{' '}
            {result.type === 'success' && (
              <Link href="/queue" className="font-medium underline">
                Open the queue
              </Link>
            )}
          </Alert>
        )}
        <div className="mt-5 flex justify-end">
          <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={submit} loading={busy}>
            {mode === 'single' ? 'Write article' : `Queue ${mode === 'multiple' ? parsedLines.length : csvRows.length} article(s)`}
          </Button>
        </div>
      </Card>
    </div>
  );
}
