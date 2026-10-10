export type Kind = 'UNKNOWN' | 'CELEBRITY' | 'TIGRAM';

const PERSON = /\b(wife|husband|spouse|net\s*worth|age|height|weight|boyfriend|girlfriend|partner|biography|bio|wiki|parents|mother|father|kids|children|son|daughter|siblings|brother|sister|family|married|marriage|divorce|dating|ethnicity|nationality|religion|birthday|salary|career|education|instagram|death|died|dead|ehefrau|ehemann|frau|mann|vermögen|alter|größe|freund|freundin|kinder|eltern|partnerin|verheiratet|freundin|tochter|sohn|geschwister|lebenslauf)\b/i;
const NOT_PERSON_START = /^(best|top|how|what|why|where|when|which|cheap|free|download|install|buy|compare|beste|bester|bestes|wie|was|warum|wo|kostenlos|günstig)\b/i;
const NOT_PERSON = /(\bnear me\b|\bin der nähe\b|\bdownload\b|\bapk\b|\bapp\b|\bsoftware\b|\breview\b|\bvs\.?\b|\bprice\b|\bpreis\b|\blogin\b|\bonline\b|\bfor (pc|windows|mac|android|iphone)\b|\btutorial\b|\bguide\b|\banleitung\b|\btest\b|\bherunterladen\b|\bv?\d+\.\d+(\.\d+)?\b|\b\d+\s*(pro|max|plus|ultra)\b)/i;

/** Wording rules: "… wife", "… net worth" mean a person; "best …", "… near me", "download …" or a version number do not. */
export function kindFromRules(keyword: string): { kind: Kind; note?: string } {
  const k = keyword.trim();
  if (NOT_PERSON_START.test(k) || NOT_PERSON.test(k)) return { kind: 'TIGRAM', note: 'wording' };
  if (PERSON.test(k)) return { kind: 'CELEBRITY', note: 'wording' };
  return { kind: 'UNKNOWN' };
}

/** Removes person words so Wikidata can be searched for the name: "sydney sweeney net worth" → "sydney sweeney". */
export function nameForLookup(keyword: string): string {
  return keyword
    .replace(new RegExp(PERSON.source, 'gi'), ' ')
    .replace(/['’]s\b/g, '')
    .replace(/\b(how|old|is|tall|the|of|and|der|die|das|von|wie|ist|groß)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type KeywordRow = { keyword: string; secondaryKeywords: string[]; title: string | null; kind?: Kind };

/**
 * One article per line: "keyword | secondary keywords | title". Columns pasted from Google Sheets (tabs) work too,
 * in the same order.
 */
export function parseKeywordRows(text: string): KeywordRow[] {
  const rows: KeywordRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = (line.includes('\t') ? line.split('\t') : line.split('|')).map((c) => c.trim());
    const keyword = cells[0] ?? '';
    if (keyword.length < 2 || /^keyword$/i.test(keyword)) continue;
    rows.push({
      keyword,
      secondaryKeywords: (cells[1] ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      title: cells[2] || null,
    });
  }
  return rows;
}

export function kindFromCsv(value: string | undefined): Kind | undefined {
  const v = (value ?? '').trim().toLowerCase();
  if (/^(celebrity|person|celeb|biography)$/.test(v)) return 'CELEBRITY';
  if (/^(tigram|other|general|tech)$/.test(v)) return 'TIGRAM';
  return undefined;
}

function csvCells(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (ch === sep) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * A CSV file with a header row. Recognised columns: keyword, secondary keywords, title, kind (or type).
 * Without a header the columns are read in that order. Commas or semicolons (German Excel) both work.
 */
export function parseKeywordCsv(text: string): KeywordRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0]!;
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : first.includes('\t') ? '\t' : ',';
  const header = csvCells(first, sep).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));
  let col = { keyword: find('keyword', 'focuskeyword', 'mainkeyword', 'keywords'), secondary: find('secondarykeywords', 'secondary', 'secondarykeyword', 'nebenkeywords'), title: find('title', 'exampletitle', 'titel'), kind: find('kind', 'type', 'writer', 'typ', 'art') };
  let body = lines.slice(1);
  if (col.keyword < 0) {
    col = { keyword: 0, secondary: 1, title: 2, kind: 3 };
    body = lines;
  }
  const rows: KeywordRow[] = [];
  for (const line of body) {
    const cells = csvCells(line, sep);
    const keyword = (cells[col.keyword] ?? '').trim();
    if (keyword.length < 2) continue;
    const secondary = col.secondary >= 0 ? (cells[col.secondary] ?? '') : '';
    rows.push({
      keyword,
      secondaryKeywords: secondary.split(sep === ',' ? /[;|]/ : /[,|]/).map((s) => s.trim()).filter(Boolean),
      title: (col.title >= 0 ? cells[col.title] : '') || null,
      kind: col.kind >= 0 ? kindFromCsv(cells[col.kind]) : undefined,
    });
  }
  return rows;
}
