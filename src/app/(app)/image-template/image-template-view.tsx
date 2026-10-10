'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Image as ImageIcon, RefreshCw, Save, Upload, Trash2, Wand2 } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { useJob } from '@/lib/use-job';
import { autoBodyDesign, autoFeaturedDesign, parseTemplateSet, type Design, type FeaturedStyle, type LogoPosition, type TemplateSet } from '@/core/image-design';
import { Alert, Button, Card, EmptyState, Field, Loading, PageHeader, Select, Tabs, Toggle } from '@/components/ui';
import { DesignEditor } from '@/components/design-editor';

type Site = { id: string; name: string };
type ImageSettings = { id: string; name: string; celebrityImages: boolean; tigramImages: boolean; logoFile: string | null; accentColour: string | null; logoPosition: LogoPosition; featuredStyle: FeaturedStyle; imageTemplate: string | null };

export function ImageTemplateView() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [siteId, setSiteId] = useState('');
  const [s, setS] = useState<ImageSettings | null>(null);
  const [templates, setTemplates] = useState<TemplateSet>({});
  const [kind, setKind] = useState<'featured' | 'body'>('featured');
  const [preview, setPreview] = useState<{ featured: string; body: string; accent: string } | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { track, running } = useJob((j) => {
    if (j.status === 'COMPLETED') setPreview(j.result as { featured: string; body: string; accent: string });
    else setMsg({ type: 'error', text: `Preview failed: ${j.error}` });
  });

  useEffect(() => {
    api<{ websites: Site[] }>('/api/websites').then((r) => {
      setSites(r.websites);
      if (r.websites[0]) setSiteId(r.websites[0].id);
    });
  }, []);

  const load = useCallback(async (id: string) => {
    const r = await api<{ website: ImageSettings }>(`/api/image-template/${id}`);
    setS(r.website);
    setTemplates(parseTemplateSet(r.website.imageTemplate));
    setDirty(false);
    setPreview(null);
  }, []);

  useEffect(() => {
    if (siteId) load(siteId);
  }, [siteId, load]);

  const refreshPreview = useCallback(
    async (settings = s, tpl = templates) => {
      if (!settings) return;
      try {
        const r = await api<{ jobId: string }>(`/api/image-template/${settings.id}/preview`, {
          body: { accentColour: settings.accentColour, logoPosition: settings.logoPosition, featuredStyle: settings.featuredStyle, imageTemplate: tpl.featured || tpl.body ? tpl : null },
        });
        track(r.jobId);
      } catch (e) {
        setMsg({ type: 'error', text: (e as Error).message });
      }
    },
    [s, templates, track],
  );

  useEffect(() => {
    if (s && !preview && !running) refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.id]);

  if (!sites) return <Loading />;
  if (!sites.length)
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Image Template" icon={<ImageIcon className="h-5 w-5" />} />
        <EmptyState title="No websites yet">
          <Link href="/websites" className="underline">
            Add a website
          </Link>{' '}
          first.
        </EmptyState>
      </div>
    );

  function set<K extends keyof ImageSettings>(k: K, v: ImageSettings[K]) {
    setS((x) => (x ? { ...x, [k]: v } : x));
    setDirty(true);
  }

  async function save() {
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/image-template/${s.id}`, {
        method: 'PUT',
        body: { celebrityImages: s.celebrityImages, tigramImages: s.tigramImages, accentColour: s.accentColour ?? '', logoPosition: s.logoPosition, featuredStyle: s.featuredStyle, imageTemplate: templates.featured || templates.body ? templates : null },
      });
      setDirty(false);
      setMsg({ type: 'success', text: 'Image template saved. New articles use it.' });
      refreshPreview();
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!s) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      await api(`/api/image-template/${s.id}/logo`, { method: 'POST', body: fd });
      await load(s.id);
      refreshPreview();
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  }

  async function removeLogo() {
    if (!s || !confirm('Remove the logo?')) return;
    await api(`/api/image-template/${s.id}/logo`, { method: 'DELETE' });
    await load(s.id);
  }

  const accent = s?.accentColour || preview?.accent || '#2753e6';
  const current: Design | null | undefined = templates[kind];

  function customize() {
    if (!s) return;
    const d = kind === 'featured' ? autoFeaturedDesign(s.featuredStyle, accent, s.logoPosition) : autoBodyDesign(s.logoPosition);
    setTemplates({ ...templates, [kind]: d });
    setDirty(true);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title="Image Template"
        icon={<ImageIcon className="h-5 w-5" />}
        description="How featured and body images look on each website (1920×1080). The automatic designs use your logo and line colour; customize them in the editor."
        actions={
          <>
            <Select className="w-56" value={siteId} onChange={(e) => (!dirty || confirm('Discard unsaved changes?')) && setSiteId(e.target.value)}>
              {sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} loading={busy} disabled={!dirty}>
              Save
            </Button>
          </>
        }
      />
      {msg && <Alert type={msg.type}>{msg.text}</Alert>}
      {!s ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
            <Card title="Settings">
              <div className="space-y-4">
                <Toggle checked={s.celebrityImages} onChange={(v) => set('celebrityImages', v)} label="Create images for celebrity articles" />
                <Toggle checked={s.tigramImages} onChange={(v) => set('tigramImages', v)} label="Create images for Tigram articles" />
                <Field label="Logo (PNG)">
                  <div className="flex items-center gap-3">
                    {s.logoFile ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/logos/${s.logoFile}`} alt="Logo" className="h-12 max-w-[160px] rounded border border-gray-200 bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:12px_12px] object-contain p-1" />
                    ) : (
                      <span className="text-sm text-gray-500">No logo</span>
                    )}
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium shadow-sm hover:bg-gray-50">
                      <Upload className="h-3.5 w-3.5" /> Upload
                      <input type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                    </label>
                    {s.logoFile && (
                      <button onClick={removeLogo} className="rounded p-1 text-gray-400 hover:text-red-600" title="Remove logo">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </Field>
                <Field label="Line colour" help="Empty = the logo's strongest colour">
                  <div className="flex items-center gap-2">
                    <input type="color" value={accent} onChange={(e) => set('accentColour', e.target.value)} className="h-9 w-14 rounded border border-gray-300" />
                    <Button size="xs" variant="ghost" onClick={() => set('accentColour', null)} disabled={!s.accentColour}>
                      Use logo colour
                    </Button>
                  </div>
                </Field>
                <Field label="Logo place">
                  <Select value={s.logoPosition} onChange={(e) => set('logoPosition', e.target.value as LogoPosition)}>
                    <option value="top-left">Top left</option>
                    <option value="top-right">Top right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-center">Bottom middle</option>
                  </Select>
                </Field>
                <Field label="Featured image style">
                  <Select value={s.featuredStyle} onChange={(e) => set('featuredStyle', e.target.value as FeaturedStyle)}>
                    <option value="split">Split: two pictures with a line and the logo between them</option>
                    <option value="single">Single: one picture with the logo in a corner</option>
                  </Select>
                </Field>
              </div>
            </Card>
            <Card
              title="Live preview"
              description="Rendered by the worker with the real renderer and sample pictures."
              actions={
                <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refreshPreview()} loading={running}>
                  Refresh preview
                </Button>
              }
            >
              {preview ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview.featured} alt="Featured preview" className="w-full rounded border border-gray-200" />
                    <figcaption className="mt-1 text-xs text-gray-500">Featured image</figcaption>
                  </figure>
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview.body} alt="Body preview" className="w-full rounded border border-gray-200" />
                    <figcaption className="mt-1 text-xs text-gray-500">Body image</figcaption>
                  </figure>
                </div>
              ) : (
                <p className="text-sm text-gray-500">{running ? 'Rendering…' : 'The worker renders the preview (it must be running).'}</p>
              )}
              {dirty && <p className="mt-2 text-xs text-amber-700">Unsaved changes are included in the preview after “Refresh preview”.</p>}
            </Card>
          </div>
          <Card title="Editor" description="Edit the featured image and the body image separately. Picture places are numbered: picture 1 is the best photo of the gallery.">
            <Tabs<'featured' | 'body'>
              value={kind}
              onChange={setKind}
              tabs={[
                { value: 'featured', label: `Featured image${templates.featured ? ' (custom)' : ''}` },
                { value: 'body', label: `Body image${templates.body ? ' (custom)' : ''}` },
              ]}
            />
            {current ? (
              <DesignEditor
                key={`${s.id}-${kind}`}
                value={current}
                logoUrl={s.logoFile ? `/api/logos/${s.logoFile}` : null}
                onChange={(d) => {
                  setTemplates({ ...templates, [kind]: d });
                  setDirty(true);
                }}
                onReset={() => {
                  setTemplates({ ...templates, [kind]: null });
                  setDirty(true);
                }}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-gray-300 py-10 text-sm text-gray-600">
                The {kind === 'featured' ? 'featured' : 'body'} image uses the automatic design.
                <Button icon={<Wand2 className="h-4 w-4" />} onClick={customize}>
                  Customize this design
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
