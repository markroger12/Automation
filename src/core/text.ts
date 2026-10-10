/** Text helpers that work for English and German (Unicode word boundaries, umlauts). */

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|figure|figcaption|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function countWords(text: string): number {
  return words(text).length;
}

/** Regex matching the keyword as whole words (Unicode boundaries), any whitespace between its words. */
export function keywordRegex(keyword: string, flags = 'giu'): RegExp {
  const parts = keyword.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\s\\u00A0]+')}(?![\\p{L}\\p{N}])`, flags);
}

export function countKeyword(text: string, keyword: string): number {
  if (!keyword.trim()) return 0;
  return (text.match(keywordRegex(keyword)) ?? []).length;
}

export function containsKeyword(text: string, keyword: string): boolean {
  return !!keyword.trim() && keywordRegex(keyword, 'iu').test(text);
}

/** Keyword density in percent (keyword occurrences × keyword words / all words). */
export function keywordDensity(text: string, keyword: string): number {
  const total = countWords(text);
  if (!total) return 0;
  const kw = Math.max(1, countWords(keyword));
  return Math.round(((countKeyword(text, keyword) * kw) / total) * 10000) / 100;
}

/** "justin biel" → "Justin Biel". Keywords that already have capitals are kept as typed. */
export function titleCaseKeyword(keyword: string): string {
  const k = keyword.trim();
  if (k !== k.toLowerCase()) return k;
  return k.replace(/(^|[\s\-'’(])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss' };

export function slugify(text: string, maxLength = 75): string {
  const base = text
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length <= maxLength) return base;
  const cut = base.slice(0, maxLength);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"„“'])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:–-]+$/, '');
}

export function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
