'use client';

import { useEffect, useState } from 'react';
import { Save, KeyRound, Copy, Settings as SettingsIcon } from 'lucide-react';
import { api } from '@/lib/client-fetch';
import { SETTINGS_GROUPS, type Settings, type SettingField } from '@/lib/settings-schema';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select, Textarea, Toggle } from '@/components/ui';
import { AutomationChromeControls } from '@/components/automation-chrome-controls';
import { UsersCard } from './users-card';

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: Settings }>('/api/settings')
      .then((r) => {
        setSettings(r.settings);
        setSaved(r.settings);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (!settings) return error ? <Alert type="error">{error}</Alert> : <Loading />;

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await api<{ settings: Settings }>('/api/settings', { method: 'PUT', body: settings });
      setSettings(r.settings);
      setSaved(r.settings);
      setMessage('Settings saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Settings"
        icon={<SettingsIcon className="h-5 w-5" />}
        description="Defaults for every article. Changes apply to stages that start after saving."
        actions={
          <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} loading={busy} disabled={!dirty}>
            Save settings
          </Button>
        }
      />
      {error && <Alert type="error" className="mb-4">{error}</Alert>}
      {message && <Alert type="success" className="mb-4">{message}</Alert>}

      <div className="space-y-5">
        <ConnectionKeyCard />
        <AutomationChromeControls />
        {SETTINGS_GROUPS.map((group) => (
          <Card key={group.title} title={group.title}>
            <div className="grid gap-4 md:grid-cols-2">
              {group.fields.map((f) => (
                <SettingInput key={f.key} field={f} value={settings[f.key]} onChange={(v) => set(f.key, v as never)} />
              ))}
            </div>
          </Card>
        ))}
        <UsersCard />
      </div>
    </div>
  );
}

function SettingInput({ field, value, onChange }: { field: SettingField; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === 'boolean') {
    return <Toggle checked={!!value} onChange={onChange} label={field.label} help={field.help} />;
  }
  if (field.type === 'select') {
    return (
      <Field label={field.label} help={field.help}>
        <Select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (field.type === 'json') {
    return (
      <Field label={field.label} help={field.help} className="md:col-span-2">
        <Textarea rows={5} className="font-mono text-xs" value={String(value)} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </Field>
    );
  }
  if (field.type === 'number') {
    return (
      <Field label={field.label} help={field.help}>
        <Input type="number" min={field.min} max={field.max} value={Number(value)} onChange={(e) => onChange(e.target.value === '' ? field.min ?? 0 : Number(e.target.value))} />
      </Field>
    );
  }
  return (
    <Field label={field.label} help={field.help}>
      <Input value={String(value)} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function ConnectionKeyCard() {
  const [info, setInfo] = useState<{ exists: boolean; createdAt: string | null } | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ exists: boolean; createdAt: string | null }>('/api/connection-key').then(setInfo).catch(() => undefined);
  }, []);

  async function create() {
    if (info?.exists && !confirm('A new key switches off the extension until you paste the new key into it. Continue?')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ key: string }>('/api/connection-key', { method: 'POST' });
      setKey(r.key);
      setInfo({ exists: true, createdAt: new Date().toISOString() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="ChatGPT Worker extension"
      description="The extension in the Automation Chrome sends the prompts on chatgpt.com. Paste this key and the app address into its popup."
      actions={
        <Button icon={<KeyRound className="h-4 w-4" />} onClick={create} loading={busy}>
          Create connection key
        </Button>
      }
    >
      {error && <Alert type="error">{error}</Alert>}
      {key ? (
        <div className="space-y-2">
          <Alert type="warning" title="Copy the key now — it is shown only once.">
            Only a fingerprint of the key is stored. Paste it into the extension popup together with the app address{' '}
            <code className="rounded bg-white/60 px-1">{typeof window !== 'undefined' ? window.location.origin : ''}</code>.
          </Alert>
          <div className="flex gap-2">
            <Input readOnly value={key} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
            <Button icon={<Copy className="h-4 w-4" />} onClick={() => navigator.clipboard.writeText(key)}>
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-600">
          {info?.exists ? `A key exists (created ${info.createdAt ? new Date(info.createdAt).toLocaleString() : 'earlier'}).` : 'No key yet. Create one to connect the extension.'}
        </p>
      )}
    </Card>
  );
}
