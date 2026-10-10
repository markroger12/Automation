'use client';

import { useEffect, useState } from 'react';
import { Play, RotateCcw, Wand2 } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { useJob } from '@/lib/use-job';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Tabs, Textarea, cn } from '@/components/ui';

type Para = { n: number; status: 'rewritten' | 'kept'; reason?: string; warnings?: string[]; before: string; after: string; problems: string[] };
type Report = { paragraphs: Para[]; rewritten: number; kept: number; densityBefore: number; densityAfter: number; rhythmBefore: number; rhythmAfter: number; parts: number; failedParts: number; notes: string[] };
type TaskOption = { id: string; keyword: string; selectedTitle: string | null };

const PROMPT_KEY = 'bas-humanizer-prompt';

export function HumanizerView() {
  const [source, setSource] = useState<'article' | 'paste'>('article');
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [taskId, setTaskId] = useState('');
  const [text, setText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [language, setLanguage] = useState<'English' | 'German'>('English');
  const [mode, setMode] = useState<'flagged' | 'every'>('flagged');
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ report: Report; conversationUrl: string | null } | null>(null);
  const { job, track, running } = useJob((j) => {
    if (j.status === 'COMPLETED') setResult(j.result as { report: Report; conversationUrl: string | null });
    else setError(j.error ?? 'The humanizer job failed.');
  });

  useEffect(() => {
    api<{ tasks: TaskOption[] }>('/api/tasks?limit=100').then((r) => {
      setTasks(r.tasks);
      if (r.tasks[0]) setTaskId(r.tasks[0].id);
    });
    api<{ defaultPrompt: string }>('/api/humanizer').then((r) => {
      setDefaultPrompt(r.defaultPrompt);
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(PROMPT_KEY);
      } catch {
        saved = null;
      }
      setPrompt(saved || r.defaultPrompt);
    });
  }, []);

  function savePrompt(v: string) {
    setPrompt(v);
    try {
      window.localStorage.setItem(PROMPT_KEY, v);
    } catch {
      // storage unavailable
    }
  }

  async function run() {
    setError(null);
    setResult(null);
    try {
      const r = await api<{ jobId: string }>('/api/humanizer', {
        body: source === 'article' ? { taskId, mode, prompt: prompt === defaultPrompt ? null : prompt } : { text, keyword, language, mode, prompt: prompt === defaultPrompt ? null : prompt },
      });
      track(r.jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const progress = job?.progress as { part?: number; of?: number } | null;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader title="AI Humanizer" icon={<Wand2 className="h-5 w-5" />} description="Test the editorial rewrite on any article or pasted text. Facts are locked: a rewrite that changes links, numbers, quotes, names, the keyword count or the length a lot keeps the original paragraph. Nothing is saved." />
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card title="Input">
          <Tabs<'article' | 'paste'>
            value={source}
            onChange={setSource}
            tabs={[
              { value: 'article', label: 'Saved article' },
              { value: 'paste', label: 'Paste HTML or text' },
            ]}
          />
          <div className="space-y-3">
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
                <Field label="Text or HTML" help="Separate paragraphs with an empty line.">
                  <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Keyword (kept as often as before)">
                    <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
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
            <Field label="Paragraphs">
              <Select value={mode} onChange={(e) => setMode(e.target.value as 'flagged' | 'every')}>
                <option value="flagged">Rewrite flagged paragraphs</option>
                <option value="every">Rewrite every paragraph</option>
              </Select>
            </Field>
            <Field label="Prompt" help="Saved in this browser. {{keyword}}, {{problems}} and {{paragraphs}} are filled in.">
              <Textarea rows={8} className="font-mono text-xs" value={prompt} onChange={(e) => savePrompt(e.target.value)} />
            </Field>
            <div className="flex justify-between">
              <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => savePrompt(defaultPrompt)} disabled={prompt === defaultPrompt}>
                Default prompt
              </Button>
              <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={run} loading={running}>
                Humanize
              </Button>
            </div>
            {running && <p className="text-xs text-gray-500">{progress?.part ? `Part ${progress.part} of ${progress.of} is with ChatGPT…` : 'Waiting for the worker and the extension…'}</p>}
            {error && <Alert type="error">{error}</Alert>}
          </div>
        </Card>
        <Card title="Result" description={result ? `${result.report.rewritten} rewritten · ${result.report.kept} kept · ${result.report.parts} part(s)` : 'Each paragraph side by side, with the reason when the original was kept.'}>
          {!result ? (
            <p className="text-sm text-gray-500">Run the humanizer to see the comparison.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">AI-signal density (per 100 words)</div>
                  <div className="text-lg font-semibold">
                    {result.report.densityBefore} → <span className={result.report.densityAfter <= result.report.densityBefore ? 'text-emerald-600' : 'text-red-600'}>{result.report.densityAfter}</span>
                  </div>
                </div>
                <div className="rounded-md border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">Sentence rhythm (variation, higher = more natural)</div>
                  <div className="text-lg font-semibold">
                    {result.report.rhythmBefore} → <span className={result.report.rhythmAfter >= result.report.rhythmBefore ? 'text-emerald-600' : 'text-red-600'}>{result.report.rhythmAfter}</span>
                  </div>
                </div>
              </div>
              {result.report.notes.length > 0 && <Alert type="info">{result.report.notes.join(' ')}</Alert>}
              <div className="space-y-3">
                {result.report.paragraphs.map((p) => (
                  <div key={p.n} className="rounded-md border border-gray-200">
                    <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs">
                      <span className="font-mono text-gray-500">[P{p.n}]</span>
                      <Badge color={p.status === 'rewritten' ? 'green' : 'gray'}>{p.status}</Badge>
                      {p.reason && <span className="text-gray-600">kept because: {p.reason}</span>}
                      {p.warnings?.map((w) => (
                        <Badge key={w} color="yellow">
                          {w}
                        </Badge>
                      ))}
                      {p.problems.length > 0 && <span className="text-gray-400">found: {p.problems.join('; ')}</span>}
                    </div>
                    <div className="grid gap-px bg-gray-100 md:grid-cols-2">
                      <div className="bg-white p-3 text-sm text-gray-700">{p.before}</div>
                      <div className={cn('p-3 text-sm', p.status === 'rewritten' ? 'bg-emerald-50/40 text-gray-900' : 'bg-white text-gray-400')}>{p.after}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
