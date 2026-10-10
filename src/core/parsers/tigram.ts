import { plainLine, stripQuotes } from './common';
import { parseFaqs, type Faq } from './faqs';
import { FAQ_HEADING_RE } from '../language';

export type TigramHeader = { seoTitle: string | null; metaDescription: string | null; slug: string | null; h1: string | null; body: string };

const LABELS: Record<string, keyof Omit<TigramHeader, 'body' | 'h1'>> = {
  'seo title': 'seoTitle',
  'seo-titel': 'seoTitle',
  'meta description': 'metaDescription',
  'meta-beschreibung': 'metaDescription',
  'url slug': 'slug',
  slug: 'slug',
};

/** Reads the SEO TITLE / META DESCRIPTION / URL SLUG lines at the start of a Tigram answer and removes them. */
export function parseTigramHeader(md: string): TigramHeader {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: TigramHeader = { seoTitle: null, metaDescription: null, slug: null, h1: null, body: '' };
  const keep: string[] = [];
  let scanned = 0;
  for (const line of lines) {
    const plain = plainLine(line);
    const m = /^([A-Za-z -]{3,20})\s*[:：]\s*(.*)$/.exec(plain);
    const key = m ? LABELS[m[1]!.trim().toLowerCase()] : undefined;
    if (key && scanned < 25 && out[key] === null) {
      out[key] = stripQuotes(m![2]!.replace(/^<|>$/g, '')) || null;
      continue;
    }
    if (line.trim()) scanned++;
    keep.push(line);
  }
  let body = keep.join('\n').trim();
  const h1 = /^\s*#\s+(.+)\n/.exec(body);
  if (h1) {
    out.h1 = plainLine(h1[1]!);
    body = body.slice(h1[0].length).trim();
  }
  if (out.slug) out.slug = out.slug.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/|\/$/g, '');
  out.body = body;
  return out;
}

/** FAQs from the "## Frequently Asked Questions" section of a Markdown article. */
export function faqsFromArticle(md: string): Faq[] {
  const parts = md.split(/\n(?=##\s)/);
  const section = parts.find((p) => FAQ_HEADING_RE.test(plainLine(p.split('\n')[0] ?? '')));
  return section ? parseFaqs(section.split('\n').slice(1).join('\n')) : [];
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").trim().toLowerCase();

/** "CATEGORY: <exact name>" → one of the website's categories. */
export function parseCategoryAnswer<T extends { name: string }>(text: string, categories: T[]): T | null {
  const m = /CATEGOR(?:Y|IE)\s*[:：]\s*(.+)/i.exec(text.replace(/\*\*/g, ''));
  const wanted = stripQuotes((m?.[1] ?? text.split('\n')[0] ?? '').trim());
  if (!wanted) return null;
  const w = decode(wanted);
  return categories.find((c) => decode(c.name) === w) ?? categories.find((c) => decode(c.name).replace(/[^a-z0-9äöüß]/g, '') === w.replace(/[^a-z0-9äöüß]/g, '')) ?? null;
}

export type PlannedImage = { description: string; text: string | null; alt: string };

/** IMAGE n / TEXT n / ALT n lines of the image plan (image 1 = featured, with text). */
export function parseImagePlan(text: string): PlannedImage[] {
  const items: Record<number, Partial<PlannedImage>> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = plainLine(raw);
    const m = /^(IMAGE|BILD|TEXT|ALT)\s*(\d)\s*[:：]\s*(.+)$/i.exec(line);
    if (!m) continue;
    const n = Number(m[2]);
    const value = stripQuotes(m[3]!);
    const it = (items[n] ??= {});
    const kind = m[1]!.toUpperCase();
    if (kind === 'IMAGE' || kind === 'BILD') it.description = value;
    else if (kind === 'TEXT') it.text = value;
    else it.alt = value;
  }
  return Object.keys(items)
    .map(Number)
    .sort((a, b) => a - b)
    .map((n) => items[n]!)
    .filter((i): i is PlannedImage => !!i.description)
    .map((i, idx) => ({ description: i.description, text: idx === 0 ? i.text ?? null : null, alt: i.alt ?? i.description }))
    .slice(0, 3);
}
