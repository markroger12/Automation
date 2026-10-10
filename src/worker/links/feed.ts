import * as cheerio from 'cheerio';

export type FeedItem = { title: string; link: string; pubDate: number };

/** Reads the website's own RSS feed (an owner-configured address, so private hosts are allowed). */
export async function readFeed(siteUrl: string, timeoutMs = 15_000): Promise<FeedItem[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${siteUrl.replace(/\/+$/, '')}/feed/`, { signal: ctrl.signal, headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!res.ok) return [];
    const xml = await res.text();
    const $ = cheerio.load(xml, { xml: true });
    return $('item')
      .toArray()
      .map((it) => ({
        title: $(it).children('title').first().text().trim(),
        link: $(it).children('link').first().text().trim(),
        pubDate: Date.parse($(it).children('pubDate').first().text()) || 0,
      }))
      .filter((i) => i.title && /^https?:\/\//.test(i.link));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export function normTitle(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&#039;|’/g, "'")
    .replace(/&#8211;|&#8212;|–|—/g, '-')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
