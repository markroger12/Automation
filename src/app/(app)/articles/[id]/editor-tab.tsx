'use client';

import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import type { ArticleDetail } from '@/lib/article-types';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import { RichEditor } from '@/components/rich-editor';

type Faq = { question: string; answer: string };
type Bio = { label: string; value: string };

export function EditorTab({ task, onSaved }: { task: ArticleDetail; onSaved: () => void }) {
  const [title, setTitle] = useState(task.selectedTitle ?? task.keyword);
  const [body, setBody] = useState(task.bodyHtml ?? '');
  const [faqs, setFaqs] = useState<Faq[]>(JSON.parse(task.faqs || '[]'));
  const [bio, setBio] = useState<Bio[]>(JSON.parse(task.quickBio || '[]'));
  const [seoTitle, setSeoTitle] = useState(task.seoTitle ?? '');
  const [meta, setMeta] = useState(task.metaDescription ?? '');
  const [slug, setSlug] = useState(task.slug ?? '');
  const [focus, setFocus] = useState(task.focusKeyword ?? task.keyword);
  const [categoryId, setCategoryId] = useState(task.categoryId ?? '');
  const [tags, setTags] = useState((JSON.parse(task.tags || '[]') as string[]).join(', '));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: {
          selectedTitle: title,
          bodyHtml: body,
          faqs: faqs.filter((f) => f.question.trim() && f.answer.trim()),
          quickBio: bio.filter((b) => b.label.trim() && b.value.trim()),
          seoTitle: seoTitle || null,
          metaDescription: meta || null,
          slug: slug || null,
          focusKeyword: focus || null,
          categoryId: categoryId || null,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        },
      });
      setMsg({ type: 'success', text: task.wpPostId ? 'Saved. Press Send to WordPress to update the draft.' : 'Saved.' });
      onSaved();
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Edit the article body; the Quick Bio, FAQs, images and the internal link are added around it when it is assembled.</p>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} loading={busy}>
          Save changes
        </Button>
      </div>
      {msg && <Alert type={msg.type}>{msg.text}</Alert>}
      <Card title="Title and content">
        <Field label="Title" className="mb-4">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <RichEditor value={body} onChange={setBody} />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="SEO">
          <div className="space-y-3">
            <Field label="SEO title" help={`${seoTitle.length} characters (up to 60)`}>
              <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
            </Field>
            <Field label="Meta description" help={`${meta.length} characters (120–160)`}>
              <Textarea rows={3} value={meta} onChange={(e) => setMeta(e.target.value)} />
            </Field>
            <Field label="Slug">
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
            </Field>
            <Field label="Focus keyword">
              <Input value={focus} onChange={(e) => setFocus(e.target.value)} />
            </Field>
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!task.website}>
                <option value="">— none —</option>
                {task.website?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tags" help="Comma separated">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
          </div>
        </Card>
        <div className="space-y-5">
          <Card title="Quick Bio" actions={<Button size="xs" icon={<Plus className="h-3 w-3" />} onClick={() => setBio([...bio, { label: '', value: '' }])}>Row</Button>}>
            {bio.length === 0 && <p className="text-sm text-gray-500">No Quick Bio.</p>}
            <div className="space-y-2">
              {bio.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="w-40" value={r.label} onChange={(e) => setBio(bio.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <Input value={r.value} onChange={(e) => setBio(bio.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <button onClick={() => setBio(bio.filter((_, j) => j !== i))} className="rounded p-1 text-gray-400 hover:text-red-600" title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </Card>
          <Card title="FAQs" actions={<Button size="xs" icon={<Plus className="h-3 w-3" />} onClick={() => setFaqs([...faqs, { question: '', answer: '' }])}>FAQ</Button>}>
            {faqs.length === 0 && <p className="text-sm text-gray-500">No FAQs.</p>}
            <div className="space-y-3">
              {faqs.map((f, i) => (
                <div key={i} className="space-y-1 rounded-md border border-gray-100 p-2">
                  <div className="flex gap-2">
                    <Input value={f.question} placeholder="Question" onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
                    <button onClick={() => setFaqs(faqs.filter((_, j) => j !== i))} className="rounded p-1 text-gray-400 hover:text-red-600" title="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <Textarea rows={2} value={f.answer} placeholder="Answer" onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
