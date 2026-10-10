'use client';

import { Field, Input, Select, Toggle } from '@/components/ui';

export type WebsiteFormValue = {
  name: string;
  url: string;
  adminUrl: string;
  editorType: 'AUTO' | 'GUTENBERG' | 'CLASSIC';
  language: 'English' | 'German';
  targetCountry: string;
  isActive: boolean;
  celebrityImages: boolean;
  tigramImages: boolean;
  internalLinkText: string;
  defaultCategoryId: string;
  searchConsoleProperty: string;
  siteTimezone: string;
};

export function emptyWebsite(): WebsiteFormValue {
  return {
    name: '',
    url: '',
    adminUrl: '',
    editorType: 'AUTO',
    language: 'English',
    targetCountry: '',
    isActive: true,
    celebrityImages: true,
    tigramImages: true,
    internalLinkText: 'Also read:',
    defaultCategoryId: '',
    searchConsoleProperty: '',
    siteTimezone: '',
  };
}

export function WebsiteForm({ value, onChange, categories }: { value: WebsiteFormValue; onChange: (v: WebsiteFormValue) => void; categories?: { id: string; name: string }[] }) {
  const set = <K extends keyof WebsiteFormValue>(k: K, v: WebsiteFormValue[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Name">
        <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Info Folks" />
      </Field>
      <Field label="Website address">
        <Input value={value.url} onChange={(e) => set('url', e.target.value)} placeholder="https://infofolks.com" />
      </Field>
      <Field label="Admin address" help="Leave empty for <address>/wp-admin">
        <Input value={value.adminUrl} onChange={(e) => set('adminUrl', e.target.value)} placeholder="https://infofolks.com/wp-admin" />
      </Field>
      <Field label="Article language">
        <Select
          value={value.language}
          onChange={(e) => {
            const language = e.target.value as WebsiteFormValue['language'];
            const defaults = ['Also read:', 'Das könnte Ihnen gefallen:', ''];
            onChange({
              ...value,
              language,
              internalLinkText: defaults.includes(value.internalLinkText) ? (language === 'German' ? 'Das könnte Ihnen gefallen:' : 'Also read:') : value.internalLinkText,
            });
          }}
        >
          <option>English</option>
          <option>German</option>
        </Select>
      </Field>
      <Field label="Target country" help="Empty = the default from Settings">
        <Input value={value.targetCountry} onChange={(e) => set('targetCountry', e.target.value)} placeholder={value.language === 'German' ? 'Germany' : 'United States'} />
      </Field>
      <Field label="Editor">
        <Select value={value.editorType} onChange={(e) => set('editorType', e.target.value as WebsiteFormValue['editorType'])}>
          <option value="AUTO">Detect automatically</option>
          <option value="GUTENBERG">Block editor (Gutenberg)</option>
          <option value="CLASSIC">Classic editor</option>
        </Select>
      </Field>
      <Field label="Internal-link line text" help='Shown in bold before the link to the previous article, e.g. "Also read:"'>
        <Input value={value.internalLinkText} onChange={(e) => set('internalLinkText', e.target.value)} />
      </Field>
      {categories && (
        <Field label="Default category">
          <Select value={value.defaultCategoryId} onChange={(e) => set('defaultCategoryId', e.target.value)}>
            <option value="">— none —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Search Console property" help="https://site/ or sc-domain:site (for indexing requests)">
        <Input value={value.searchConsoleProperty} onChange={(e) => set('searchConsoleProperty', e.target.value)} placeholder="sc-domain:infofolks.com" />
      </Field>
      <Field label="WordPress time zone" help="Read from WordPress after the first login">
        <Input value={value.siteTimezone} onChange={(e) => set('siteTimezone', e.target.value)} placeholder="Europe/Berlin" />
      </Field>
      <div className="space-y-3 md:col-span-2">
        <Toggle checked={value.isActive} onChange={(v) => set('isActive', v)} label="Active" help="Inactive websites are hidden from the writer forms." />
        <Toggle checked={value.celebrityImages} onChange={(v) => set('celebrityImages', v)} label="Create images for celebrity articles" />
        <Toggle checked={value.tigramImages} onChange={(v) => set('tigramImages', v)} label="Create images for Tigram articles" />
      </div>
    </div>
  );
}
