'use client';

import { useEffect, useState } from 'react';
import { MessageSquareText, RotateCcw, Save } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { Alert, Badge, Button, Card, Loading, PageHeader, Textarea, cn } from '@/components/ui';

type PromptView = { id: string | null; key: string; name: string; description: string; variables: { name: string; description: string }[]; content: string; isDefault: boolean; updatedAt: string | null };
type ModuleView = { key: string; name: string; prompts: PromptView[] };

export function PromptManager() {
  const [modules, setModules] = useState<ModuleView[] | null>(null);
  const [moduleKey, setModuleKey] = useState('');
  const [promptKey, setPromptKey] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function load(keep = false) {
    const r = await api<{ modules: ModuleView[] }>('/api/prompts');
    setModules(r.modules);
    if (!keep) {
      const m = r.modules[0];
      setModuleKey(m?.key ?? '');
      setPromptKey(m?.prompts[0]?.key ?? '');
      setDraft(m?.prompts[0]?.content ?? '');
    }
  }
  useEffect(() => {
    load();
  }, []);

  if (!modules) return <Loading />;
  const mod = modules.find((m) => m.key === moduleKey);
  const prompt = mod?.prompts.find((p) => p.key === promptKey);
  const dirty = prompt ? draft !== prompt.content : false;

  function select(m: string, p: string) {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    const pr = modules!.find((x) => x.key === m)?.prompts.find((x) => x.key === p);
    setModuleKey(m);
    setPromptKey(p);
    setDraft(pr?.content ?? '');
    setMsg(null);
  }

  async function save(reset = false) {
    if (!prompt?.id) return;
    if (reset && !confirm('Replace this prompt with the built-in default?')) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ content: string }>(`/api/prompts/${prompt.id}`, { method: 'PUT', body: reset ? { reset: true } : { content: draft } });
      setDraft(r.content);
      await load(true);
      setMsg({ type: 'success', text: reset ? 'Default restored.' : 'Prompt saved. Default updates will never overwrite it.' });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Prompt Manager" icon={<MessageSquareText className="h-5 w-5" />} description="Every prompt of every module. Variables in {{double braces}} are filled in by the app; {{#if x}}…{{/if}} and {{#unless x}}…{{/unless}} show text only when a value is (not) set." />
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <nav className="space-y-4">
          {modules.map((m) => (
            <div key={m.key}>
              <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{m.name}</div>
              <ul className="space-y-0.5">
                {m.prompts.map((p) => (
                  <li key={p.key}>
                    <button onClick={() => select(m.key, p.key)} className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm', m.key === moduleKey && p.key === promptKey ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-700 hover:bg-gray-100')}>
                      <span className="truncate">{p.name}</span>
                      {!p.isDefault && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Edited" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        {prompt && (
          <Card
            title={
              <span className="flex items-center gap-2">
                {prompt.name} {!prompt.isDefault && <Badge color="yellow">edited</Badge>}
              </span>
            }
            description={prompt.description}
            actions={
              <>
                <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => save(true)} disabled={busy || prompt.isDefault}>
                  Reset to default
                </Button>
                <Button size="sm" variant="primary" icon={<Save className="h-4 w-4" />} onClick={() => save(false)} loading={busy} disabled={!dirty}>
                  Save
                </Button>
              </>
            }
          >
            {msg && <Alert type={msg.type} className="mb-3">{msg.text}</Alert>}
            <Textarea rows={26} className="font-mono text-xs leading-5" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Variables</div>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {prompt.variables.map((v) => (
                  <div key={v.name} className="flex gap-2">
                    <dt>
                      <code className="rounded bg-gray-100 px-1 text-xs">{`{{${v.name}}}`}</code>
                    </dt>
                    <dd className="text-gray-600">{v.description}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-gray-500">The app appends a language line (for example “Write in German for readers in Germany.”) to every text prompt.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
