import type { BioRow } from './parsers/quick-bio';
import { titleCaseKeyword } from './text';

const PROFESSION_LABELS = /^(profession|occupation|known as|famous for|beruf|tätigkeit|bekannt (als|für))$/i;

/** Tags for the WordPress post: keyword, secondary keywords and the person's professions. */
export function suggestTags(keyword: string, opts: { secondary?: string[]; quickBio?: BioRow[]; extra?: string[] } = {}): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const v = t.replace(/[.;]+$/, '').replace(/\s+/g, ' ').trim();
    if (v.length < 2 || v.length > 40 || /not publicly|nicht öffentlich|unknown/i.test(v)) return;
    if (!out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  add(titleCaseKeyword(keyword));
  for (const t of opts.extra ?? []) add(t);
  for (const s of opts.secondary ?? []) add(s);
  for (const row of opts.quickBio ?? []) {
    if (!PROFESSION_LABELS.test(row.label.trim())) continue;
    for (const part of row.value.split(/,|\/|\band\b|\bund\b|&/i)) {
      const p = part.trim();
      if (p && p.split(/\s+/).length <= 3) add(p.charAt(0).toUpperCase() + p.slice(1));
    }
  }
  return out.slice(0, 10);
}
