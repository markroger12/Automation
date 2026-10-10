import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';
import { escapeRegExp, normalizeSpace } from './text';
import type { Lang } from './language';

export type LinkSuggestion = { phrase: string; url: string };
export type LinkKind = 'wikipedia' | 'imdb' | 'reference' | 'university' | 'official';
export type TrustDecision = { ok: true; kind: LinkKind } | { ok: false; reason: string };

/** "LINK: <phrase> | <URL>" lines (bullets, bold and Markdown links tolerated). */
export function parseLinkSuggestions(text: string): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim();
    const m = /^LINK\s*[:：]\s*(.+?)\s*\|\s*(\S+)\s*$/i.exec(line);
    if (!m) continue;
    let url = m[2]!.replace(/^<|>$/g, '');
    const md = /^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/.exec(url);
    if (md) url = md[1]!;
    url = url.replace(/[.,;)]+$/, '');
    const phrase = m[1]!.replace(/^["'“„]|["'”“]$/g, '').trim();
    try {
      const u = new URL(url);
      if (phrase && !out.some((o) => o.phrase.toLowerCase() === phrase.toLowerCase())) out.push({ phrase, url: u.toString() });
    } catch {
      // not a URL
    }
  }
  return out;
}

const BLOCKED_HOSTS = [
  // social media
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'linkedin.com', 'snapchat.com', 'threads.net', 'tumblr.com', 'youtube.com', 'youtu.be', 'vk.com', 'telegram.me', 't.me', 'quora.com', 'medium.com', 'substack.com', 'wikia.org', 'fandom.com',
  // shops
  'amazon.com', 'amazon.de', 'amazon.co.uk', 'ebay.com', 'ebay.de', 'etsy.com', 'walmart.com', 'aliexpress.com', 'temu.com', 'shein.com', 'bestbuy.com', 'target.com', 'otto.de', 'zalando.de',
  // gossip and net-worth sites
  'celebritynetworth.com', 'wealthygorilla.com', 'networthspot.com', 'celebsages.com', 'famousbirthdays.com', 'whosdatedwho.com', 'distractify.com', 'thethings.com', 'tmz.com', 'radaronline.com', 'perezhilton.com', 'hollywoodlife.com', 'gossipcop.com', 'dailymail.co.uk', 'thesun.co.uk', 'mirror.co.uk', 'nickiswift.com', 'bio.com', 'heightline.com', 'starsunfolded.com', 'marriedbiography.com', 'idolnetworth.com', 'networthpost.org', 'bild.de', 'promiflash.de', 'gala.de', 'bunte.de',
];

const REFERENCE_HOSTS = [
  'britannica.com', 'variety.com', 'billboard.com', 'rollingstone.com', 'espn.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com', 'reuters.com', 'apnews.com', 'hollywoodreporter.com', 'deadline.com', 'forbes.com', 'cnn.com', 'npr.org',
  'nationalgeographic.com', 'time.com', 'washingtonpost.com', 'latimes.com', 'usatoday.com', 'cbsnews.com', 'nbcnews.com', 'abcnews.go.com', 'pbs.org', 'smithsonianmag.com', 'history.com', 'rottentomatoes.com', 'metacritic.com', 'allmusic.com',
  'olympics.com', 'fifa.com', 'uefa.com', 'nba.com', 'nfl.com', 'mlb.com', 'nhl.com', 'atptour.com', 'wtatennis.com', 'formula1.com', 'grammy.com', 'oscars.org', 'emmys.com', 'goldenglobes.com', 'tonyawards.com', 'bafta.org', 'nobelprize.org',
  'spiegel.de', 'zeit.de', 'faz.net', 'sueddeutsche.de', 'tagesschau.de', 'zdf.de', 'ard.de', 'br.de', 'ndr.de', 'wdr.de', 'swr.de', 'mdr.de', 'deutschlandfunk.de', 'stern.de', 'kicker.de', 'dfb.de', 'bundesliga.com', 'filmportal.de', 'welt.de', 'handelsblatt.com', 'nzz.ch', 'derstandard.at', 'orf.at', 'srf.ch',
];

const STOPWORDS = new Set(['the', 'of', 'and', 'for', 'a', 'an', 'at', 'in', 'on', 'de', 'der', 'die', 'das', 'von', 'und', 'für', 'la', 'le', 'du', 'des', 'del', 'di']);

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The first label of the registrable domain: "www.chla.org" → "chla", "news.paramount.co.uk" → "paramount". */
export function siteLabel(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  const twoLevelTld = parts.length >= 3 && /^(co|com|ac|gov|org|net|edu)$/.test(parts[parts.length - 2]!) && parts[parts.length - 1]!.length === 2;
  return parts[parts.length - (twoLevelTld ? 3 : 2)] ?? parts[0] ?? '';
}

/** A site named after the organisation: host = joined words, a 6+ letter prefix of them, or the initials (chla.org, lmu.edu). */
export function isOrganisationSite(host: string, phrase: string): boolean {
  const label = siteLabel(host).replace(/-/g, '');
  const words = phrase
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!label || !words.length) return false;
  const joined = words.join('');
  const significant = words.filter((w) => !STOPWORDS.has(w));
  const initials = significant.map((w) => w[0]).join('');
  if (label === joined) return true;
  if (label.length >= 6 && joined.startsWith(label)) return true;
  if (initials.length >= 2 && label === initials) return true;
  return false;
}

export function isUniversityOrPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  return /\.(edu|gov|mil)$/.test(h) || /\.(ac|edu|gov)\.[a-z]{2}$/.test(h) || /\.bund\.de$|\.europa\.eu$|\.gv\.at$|\.admin\.ch$/.test(h) || /(^|\.)(uni|tu|fh|hs)-[a-z-]+\.de$/.test(h) || /(^|\.)uni[a-z-]*\.(de|at|ch)$/.test(h);
}

/** Trusted sites only: Wikipedia in the article's language, IMDb, large reference/news sites, universities and public bodies, organisation sites. */
export function checkTrustedUrl(url: string, phrase: string, language: Lang): TrustDecision {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'not a valid address' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not https' };
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.some((d) => hostMatches(host, d))) return { ok: false, reason: `${host} is social media, a shop or a gossip/net-worth site` };
  if (hostMatches(host, 'wikipedia.org')) {
    const want = language === 'German' ? 'de.wikipedia.org' : 'en.wikipedia.org';
    const h = host.replace(/^www\./, '').replace('.m.wikipedia.org', '.wikipedia.org');
    if (h !== want) return { ok: false, reason: `Wikipedia in the wrong language (${host}, wanted ${want})` };
    if (!/^\/wiki\/[^:]+$/.test(decodeURIComponent(u.pathname)) || /^\/wiki\/(Special|Spezial|File|Datei|Category|Kategorie|Help|Hilfe):/i.test(decodeURIComponent(u.pathname))) return { ok: false, reason: 'not a Wikipedia article' };
    return { ok: true, kind: 'wikipedia' };
  }
  if (hostMatches(host, 'imdb.com')) {
    if (!/^\/(title\/tt\d+|name\/nm\d+)/.test(u.pathname)) return { ok: false, reason: 'IMDb link is not a title or name page' };
    return { ok: true, kind: 'imdb' };
  }
  if (REFERENCE_HOSTS.some((d) => hostMatches(host, d))) return { ok: true, kind: 'reference' };
  if (isUniversityOrPublicHost(host)) return { ok: true, kind: 'university' };
  if (isOrganisationSite(host, phrase)) return { ok: true, kind: 'official' };
  return { ok: false, reason: `${host} is not on the trusted list and not named after "${phrase}"` };
}

export function imdbIdFromUrl(url: string): string | null {
  return /\/(tt\d+|nm\d+)/.exec(url)?.[1] ?? null;
}

export function wikipediaTitleFromUrl(url: string): string | null {
  const m = /\/wiki\/([^?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]!).replace(/_/g, ' ') : null;
}

function normTitle(s: string): string {
  return normalizeSpace(
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9ß ]+/g, ' '),
  );
}

/** The page title is about the phrase: every significant word of the phrase is in the title (or the other way round). */
export function titleMatchesPhrase(title: string, phrase: string): boolean {
  const t = normTitle(title);
  const p = normTitle(phrase);
  if (!t || !p) return false;
  if (t === p || t.includes(p)) return true;
  const pw = p.split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const tw = new Set(t.split(' '));
  if (pw.length && pw.every((w) => tw.has(w))) return true;
  const core = t.split(/ [-–|:] /)[0]!.trim();
  return !!core && p.includes(core) && core.length >= 4;
}

export type PlacedLink = { phrase: string; url: string; kind: LinkKind };
export type PlacementResult = { html: string; added: PlacedLink[]; refused: { phrase: string; url: string; reason: string }[] };

const LINKABLE = new Set(['p', 'li', 'td', 'blockquote']);

/**
 * Links each phrase once, inside a paragraph (p, li, td or blockquote — never a heading), at most 2 links per
 * paragraph counting existing ones (later mentions are used when a paragraph is full), at most `max` links,
 * Wikipedia at most half of them, non-Wikipedia links placed first.
 */
export function placeLinks(html: string, links: PlacedLink[], opts: { max: number; keyword: string }): PlacementResult {
  const $ = cheerio.load(`<div id="__r">${html}</div>`);
  const added: PlacedLink[] = [];
  const refused: PlacementResult['refused'] = [];
  const wikiLimit = Math.floor(opts.max / 2);
  const ordered = [...links.filter((l) => l.kind !== 'wikipedia'), ...links.filter((l) => l.kind === 'wikipedia')];
  const blocks = $('#__r')
    .find('p, li, td, blockquote')
    .toArray()
    .filter((el) => LINKABLE.has((el as Element).name) && !$(el).parents('h1,h2,h3,h4,h5,h6').length) as Element[];

  for (const link of ordered) {
    if (added.length >= opts.max) {
      refused.push({ ...link, reason: `already ${opts.max} links` });
      continue;
    }
    if (link.kind === 'wikipedia' && added.filter((a) => a.kind === 'wikipedia').length >= wikiLimit) {
      refused.push({ ...link, reason: `Wikipedia may have at most ${wikiLimit} of the links` });
      continue;
    }
    if (normTitle(link.phrase) === normTitle(opts.keyword) || normTitle(opts.keyword).includes(normTitle(link.phrase))) {
      refused.push({ ...link, reason: 'it is the article keyword' });
      continue;
    }
    if (added.some((a) => a.url === link.url)) {
      refused.push({ ...link, reason: 'same address already linked' });
      continue;
    }
    let placed = false;
    let sawPhrase = false;
    for (const block of blocks) {
      if ($(block).find('a').length >= 2) {
        if ($(block).text().includes(link.phrase)) sawPhrase = true;
        continue;
      }
      if (insertInBlock($, block, link)) {
        placed = true;
        break;
      }
    }
    if (placed) added.push(link);
    else refused.push({ ...link, reason: sawPhrase ? 'every paragraph with the phrase already has 2 links' : 'the phrase is not in a paragraph of the article' });
  }
  return { html: $('#__r').html() ?? html, added, refused };
}

function insertInBlock($: cheerio.CheerioAPI, block: Element, link: PlacedLink): boolean {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(link.phrase)}(?![\\p{L}\\p{N}])`, 'u');
  const walk = (node: AnyNode): boolean => {
    if (node.type === 'text') {
      const text = (node as Text).data;
      const m = re.exec(text);
      if (!m) return false;
      const before = text.slice(0, m.index);
      const after = text.slice(m.index + m[0].length);
      const anchor = `<a href="${escapeAttr(link.url)}" target="_blank" rel="noopener">${escapeText(m[0])}</a>`;
      $(node as AnyNode).replaceWith(`${escapeText(before)}${anchor}${escapeText(after)}`);
      return true;
    }
    if (node.type === 'tag') {
      const el = node as Element;
      if (el.name === 'a' || /^h[1-6]$/.test(el.name)) return false;
      for (const child of [...(el.children as AnyNode[])]) if (walk(child)) return true;
    }
    return false;
  };
  return walk(block);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
