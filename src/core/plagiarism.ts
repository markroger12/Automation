import * as cheerio from 'cheerio';

/**
 * Plagiarism evidence: passages of an article that also appear in a source, shown side by side.
 * There is deliberately no percentage or verdict; the owner reads the passages and decides.
 *
 * - Anchors are 5-word sequences. From each shared anchor the run is grown in both directions.
 * - An exact run counts when it has 8+ words, 4 of them content words.
 * - A sentence whose words are at least 80% the same (word-level edit similarity) is a close copy.
 * - Quoted text and boilerplate (5-word sequences found in at least 10% of the owner's own articles) are shown
 *   but not counted.
 */

export const ANCHOR = 5;
export const MIN_RUN_WORDS = 8;
export const MIN_CONTENT_WORDS = 4;
export const CLOSE_SIMILARITY = 0.8;
export const BOILERPLATE_SHARE = 0.1;

const STOP = new Set(
  (
    'a an the and or but if then than so as at by for from in into of off on onto out over to up with without about above after again against all also am are around be been before being below between both can could did do does doing down during each few further had has have having he her here hers herself him himself his how i im is it its itself just me more most my myself no nor not now once only other our ours ourselves own same she should some such that thats their theirs them themselves there these they this those through too under until very was we were what when where which while who whom why will would you your yours yourself yourselves s t don isnt wasnt arent werent doesnt didnt hasnt havent wont cant shes hes theyre theres one two also many much may might must shall us via per yet ever every any lot well even still get got make made like just really' +
    ' der die das den dem des ein eine einer eines einem einen und oder aber wenn dann als so wie bei mit von vom zu zum zur aus auf an am im in ins um für über unter nach vor durch gegen ohne bis seit ist sind war waren wird werden wurde wurden hat haben hatte hatten sein seine seiner seinem seinen ihr ihre ihrer ihrem ihren er sie es wir ihr ich du man nicht kein keine auch noch nur schon sehr mehr viel viele dass daß was wer wo wann warum welche welcher welches dieser diese dieses diesem diesen jener jene sich mich dich uns euch mir dir ihm ihnen hier dort da doch ja nein kann können konnte konnten muss müssen soll sollen will wollen darf dürfen mag mögen habe hast bin bist sei'
  ).split(/\s+/),
);

export type Token = { w: string; start: number; end: number; quoted: boolean; content: boolean };
export type Sentence = { start: number; end: number; ti: number; tj: number };
export type Doc = { text: string; tokens: Token[]; sentences: Sentence[] };

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const QUOTE_PAIRS: Record<string, string> = { '"': '"', '“': '”', '„': '“', '«': '»', '»': '«' };

export function normWord(w: string): string {
  return w.normalize('NFKC').toLowerCase().replace(/’/g, "'").replace(/'s$/, '').replace(/'/g, '');
}

export function isContentWord(w: string): boolean {
  return !STOP.has(w) && (w.length > 2 || /\d/.test(w));
}

/** Character ranges inside quotation marks (per line). */
function quotedRanges(text: string, extra: [number, number][] = []): [number, number][] {
  const ranges: [number, number][] = [...extra];
  let open: { ch: string; at: number } | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\n') {
      open = null;
      continue;
    }
    if (open) {
      if (ch === QUOTE_PAIRS[open.ch] || (open.ch === '"' && ch === '"')) {
        if (i - open.at > 1) ranges.push([open.at, i + 1]);
        open = null;
      }
    } else if (ch in QUOTE_PAIRS) {
      // A straight quote right after a letter is an inch mark or a typo, not an opening quote.
      if (ch === '"' && i > 0 && /[\p{L}\p{N}]/u.test(text[i - 1]!)) continue;
      open = { ch, at: i };
    }
  }
  return ranges;
}

/** Builds a document from plain text (one block per line). `quoted` adds ranges that are quotations (blockquotes). */
export function makeDoc(text: string, quoted: [number, number][] = []): Doc {
  const ranges = quotedRanges(text, quoted);
  const tokens: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    const start = m.index!;
    const end = start + m[0].length;
    const w = normWord(m[0]);
    if (!w) continue;
    tokens.push({ w, start, end, quoted: ranges.some(([a, b]) => start >= a && end <= b), content: isContentWord(w) });
  }
  const sentences: Sentence[] = [];
  const re = /[^\n]+/g;
  let ti = 0;
  for (const line of text.matchAll(re)) {
    const lineStart = line.index!;
    const parts = line[0].split(/(?<=[.!?…]["”“»]?)\s+(?=["„“«]?[\p{Lu}\p{N}])/u);
    let offset = lineStart;
    for (const part of parts) {
      const s = text.indexOf(part, offset);
      const e = s + part.length;
      offset = e;
      while (ti < tokens.length && tokens[ti]!.start < s) ti++;
      let tj = ti;
      while (tj < tokens.length && tokens[tj]!.end <= e) tj++;
      if (tj > ti) sentences.push({ start: s, end: e, ti, tj });
      ti = tj;
    }
  }
  return { text, tokens, sentences };
}

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, figcaption, dt, dd, pre';

/** Article or web page HTML → document. Blockquotes and <q> count as quoted. Navigation and scripts are dropped. */
export function docFromHtml(html: string, opts: { page?: boolean } = {}): Doc {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, svg, iframe, form, button, select, textarea').remove();
  let main = $('body');
  if (opts.page) {
    $('nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], .sidebar, #sidebar, .comments, #comments, .related, .share, .breadcrumb, .breadcrumbs, .cookie, .newsletter').remove();
    for (const sel of ['article', 'main', '[role=main]']) {
      const found = $(sel).first();
      if (found.length) {
        main = found as typeof main;
        break;
      }
    }
  }
  const lines: string[] = [];
  const quoted: [number, number][] = [];
  let pos = 0;
  const push = (t: string, isQuote: boolean) => {
    const line = t.replace(/\s+/g, ' ').trim();
    if (!line) return;
    if (isQuote) quoted.push([pos, pos + line.length]);
    lines.push(line);
    pos += line.length + 1;
  };
  const blocks = main.find(BLOCKS).filter((_, el) => $(el).parents(BLOCKS).length === 0);
  if (blocks.length) {
    blocks.each((_, el) => {
      const $el = $(el);
      const isQuote = $el.is('blockquote');
      if (!isQuote) {
        $el.find('q').each((__, q) => {
          $(q).replaceWith(`“${$(q).text()}”`);
        });
      }
      push($el.text(), isQuote);
    });
  } else {
    for (const l of (main.length ? main.text() : $.root().text()).split(/\n+/)) push(l, false);
  }
  return makeDoc(lines.join('\n'), quoted);
}

/** Plain text → document (paragraphs or lines; Markdown "> " lines are quotes). */
export function docFromText(text: string): Doc {
  const lines: string[] = [];
  const quoted: [number, number][] = [];
  let pos = 0;
  for (const raw of text.split(/\n+/)) {
    let line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const isQuote = line.startsWith('>');
    line = line.replace(/^>\s*/, '').replace(/^#+\s*/, '');
    if (isQuote) quoted.push([pos, pos + line.length]);
    lines.push(line);
    pos += line.length + 1;
  }
  return makeDoc(lines.join('\n'), quoted);
}

function gram(tokens: Token[], i: number): string {
  let s = tokens[i]!.w;
  for (let k = 1; k < ANCHOR; k++) s += ' ' + tokens[i + k]!.w;
  return s;
}

export function grams(doc: Doc): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + ANCHOR <= doc.tokens.length; i++) out.add(gram(doc.tokens, i));
  return out;
}

/** 5-word sequences found in at least 10% of the owner's articles (and in at least 2). Needs 5+ articles. */
export function boilerplateGrams(own: Doc[], share = BOILERPLATE_SHARE): Set<string> {
  const out = new Set<string>();
  if (own.length < 5) return out;
  const need = Math.max(2, Math.ceil(own.length * share));
  const counts = new Map<string, number>();
  for (const d of own) for (const g of grams(d)) counts.set(g, (counts.get(g) ?? 0) + 1);
  for (const [g, n] of counts) if (n >= need) out.add(g);
  return out;
}

export type DiffWord = { t: string; same: boolean };

export type Passage = {
  kind: 'exact' | 'close';
  /** Words on the article side. */
  words: number;
  contentWords: number;
  /** 1 for exact runs. */
  similarity: number;
  counted: boolean;
  why?: 'quoted' | 'boilerplate';
  /** Character range in the article text. */
  articleStart: number;
  articleEnd: number;
  articleText: string;
  sourceText: string;
  sourceBefore: string;
  sourceAfter: string;
  articleDiff?: DiffWord[];
  sourceDiff?: DiffWord[];
};

export type Comparison = { passages: Passage[]; countedWords: number; shownWords: number };

function indexGrams(doc: Doc): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (let i = 0; i + ANCHOR <= doc.tokens.length; i++) {
    const g = gram(doc.tokens, i);
    const list = idx.get(g);
    if (list) {
      if (list.length < 50) list.push(i);
    } else idx.set(g, [i]);
  }
  return idx;
}

function context(doc: Doc, ti: number, tj: number, words = 12): { text: string; before: string; after: string } {
  const t = doc.tokens;
  const s = t[ti]!.start;
  const e = t[tj - 1]!.end;
  const bs = t[Math.max(0, ti - words)]!.start;
  const ae = t[Math.min(t.length - 1, tj - 1 + words)]!.end;
  const cut = (x: string) => x.replace(/\s+/g, ' ');
  return { text: cut(doc.text.slice(s, e)), before: cut(doc.text.slice(bs, s)).trimStart(), after: cut(doc.text.slice(e, ae)).trimEnd() };
}

function flags(a: Doc, ti: number, tj: number, boiler: Set<string>): { counted: boolean; why?: 'quoted' | 'boilerplate' } {
  const n = tj - ti;
  let quoted = 0;
  for (let i = ti; i < tj; i++) if (a.tokens[i]!.quoted) quoted++;
  if (quoted * 2 >= n) return { counted: false, why: 'quoted' };
  if (boiler.size) {
    let total = 0;
    let hit = 0;
    for (let i = ti; i + ANCHOR <= tj; i++) {
      total++;
      if (boiler.has(gram(a.tokens, i))) hit++;
    }
    if (total && hit * 2 >= total) return { counted: false, why: 'boilerplate' };
  }
  return { counted: true };
}

function contentCount(tokens: Token[], i: number, j: number): number {
  let n = 0;
  for (let k = i; k < j; k++) if (tokens[k]!.content) n++;
  return n;
}

/** Word-level Levenshtein similarity: 1 − distance / longer length. */
export function editSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

/** Marks the words two sentences share (longest common subsequence). */
export function diffWords(a: Doc, ai: number, aj: number, b: Doc, bi: number, bj: number): { a: DiffWord[]; b: DiffWord[] } {
  const A = a.tokens.slice(ai, aj);
  const B = b.tokens.slice(bi, bj);
  const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i]![j] = A[i]!.w === B[j]!.w ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const sa = new Array<boolean>(A.length).fill(false);
  const sb = new Array<boolean>(B.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i]!.w === B[j]!.w) {
      sa[i++] = true;
      sb[j++] = true;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return { a: A.map((t, k) => ({ t: a.text.slice(t.start, t.end), same: sa[k]! })), b: B.map((t, k) => ({ t: b.text.slice(t.start, t.end), same: sb[k]! })) };
}

/** Compares the article with one source. */
export function compareDocs(article: Doc, source: Doc, boiler: Set<string> = new Set()): Comparison {
  const A = article.tokens;
  const S = source.tokens;
  const passages: Passage[] = [];
  const covered = new Array<boolean>(A.length).fill(false);

  // Exact runs grown from shared 5-word anchors.
  const idx = indexGrams(source);
  const runs: { ai: number; aj: number; si: number; sj: number }[] = [];
  for (let i = 0; i + ANCHOR <= A.length; i++) {
    const hits = idx.get(gram(A, i));
    if (!hits) continue;
    for (const j of hits) {
      if (i > 0 && j > 0 && A[i - 1]!.w === S[j - 1]!.w) continue; // found from an earlier anchor
      let k = ANCHOR;
      while (i + k < A.length && j + k < S.length && A[i + k]!.w === S[j + k]!.w) k++;
      runs.push({ ai: i, aj: i + k, si: j, sj: j + k });
    }
  }
  runs.sort((x, y) => y.aj - y.ai - (x.aj - x.ai) || x.ai - y.ai);
  for (const r of runs) {
    const n = r.aj - r.ai;
    if (n < MIN_RUN_WORDS || contentCount(A, r.ai, r.aj) < MIN_CONTENT_WORDS) continue;
    let already = 0;
    for (let k = r.ai; k < r.aj; k++) if (covered[k]) already++;
    if (already * 2 >= n) continue;
    for (let k = r.ai; k < r.aj; k++) covered[k] = true;
    const src = context(source, r.si, r.sj);
    passages.push({
      kind: 'exact',
      words: n,
      contentWords: contentCount(A, r.ai, r.aj),
      similarity: 1,
      ...flags(article, r.ai, r.aj, boiler),
      articleStart: A[r.ai]!.start,
      articleEnd: A[r.aj - 1]!.end,
      articleText: article.text.slice(A[r.ai]!.start, A[r.aj - 1]!.end),
      sourceText: src.text,
      sourceBefore: src.before,
      sourceAfter: src.after,
    });
  }

  // Close copies: reworded sentences.
  const byWord = new Map<string, number[]>();
  source.sentences.forEach((s, n) => {
    if (s.tj - s.ti < MIN_RUN_WORDS) return;
    for (const w of new Set(S.slice(s.ti, s.tj).filter((t) => t.content).map((t) => t.w))) {
      const list = byWord.get(w);
      if (list) list.push(n);
      else byWord.set(w, [n]);
    }
  });
  for (const s of article.sentences) {
    const n = s.tj - s.ti;
    if (n < MIN_RUN_WORDS) continue;
    let cov = 0;
    for (let k = s.ti; k < s.tj; k++) if (covered[k]) cov++;
    if (cov >= n * 0.8) continue;
    const contentSet = new Set(A.slice(s.ti, s.tj).filter((t) => t.content).map((t) => t.w));
    if (contentSet.size < MIN_CONTENT_WORDS) continue;
    const shared = new Map<number, number>();
    for (const w of contentSet) for (const sn of byWord.get(w) ?? []) shared.set(sn, (shared.get(sn) ?? 0) + 1);
    let best: { sn: number; sim: number } | null = null;
    const aw = A.slice(s.ti, s.tj).map((t) => t.w);
    for (const [sn, count] of shared) {
      if (count < Math.max(3, contentSet.size * 0.5)) continue;
      const ss = source.sentences[sn]!;
      const sim = editSimilarity(
        aw,
        S.slice(ss.ti, ss.tj).map((t) => t.w),
      );
      if (sim >= CLOSE_SIMILARITY && (!best || sim > best.sim)) best = { sn, sim };
    }
    if (!best) continue;
    const ss = source.sentences[best.sn]!;
    for (let k = s.ti; k < s.tj; k++) covered[k] = true;
    // The whole sentence with its changed words says more than the exact pieces inside it.
    for (let k = passages.length - 1; k >= 0; k--) {
      const p = passages[k]!;
      if (p.kind === 'exact' && p.articleStart >= A[s.ti]!.start && p.articleEnd <= A[s.tj - 1]!.end) passages.splice(k, 1);
    }
    const d = diffWords(article, s.ti, s.tj, source, ss.ti, ss.tj);
    const src = context(source, ss.ti, ss.tj, 8);
    passages.push({
      kind: 'close',
      words: n,
      contentWords: contentSet.size,
      similarity: Math.round(best.sim * 100) / 100,
      ...flags(article, s.ti, s.tj, boiler),
      articleStart: A[s.ti]!.start,
      articleEnd: A[s.tj - 1]!.end,
      articleText: article.text.slice(A[s.ti]!.start, A[s.tj - 1]!.end),
      sourceText: src.text,
      sourceBefore: src.before,
      sourceAfter: src.after,
      articleDiff: d.a,
      sourceDiff: d.b,
    });
  }

  passages.sort((x, y) => x.articleStart - y.articleStart);
  return { passages, countedWords: wordsIn(article, passages.filter((p) => p.counted)), shownWords: wordsIn(article, passages) };
}

/** Article words inside the given passages (each word once). */
export function wordsIn(article: Doc, passages: Pick<Passage, 'articleStart' | 'articleEnd'>[]): number {
  let n = 0;
  for (const t of article.tokens) if (passages.some((p) => t.start >= p.articleStart && t.end <= p.articleEnd)) n++;
  return n;
}

/**
 * Phrases to look up as exact Google searches: 10-word windows from different sentences, no numbers (facts like
 * dates are shared by every page), not quoted, not boilerplate, rich in long content words.
 */
export function distinctivePhrases(doc: Doc, boiler: Set<string> = new Set(), count = 10, len = 10): string[] {
  const cands: { score: number; at: number; text: string }[] = [];
  for (const s of doc.sentences) {
    if (s.tj - s.ti < len) continue;
    if (/\d/.test(doc.text.slice(s.start, s.end))) continue;
    let best: { score: number; at: number; text: string } | null = null;
    for (let i = s.ti; i + len <= s.tj; i += 2) {
      const win = doc.tokens.slice(i, i + len);
      if (win.some((t) => t.quoted)) continue;
      let boilerHit = false;
      for (let k = i; k + ANCHOR <= i + len; k++) if (boiler.has(gram(doc.tokens, k))) boilerHit = true;
      if (boilerHit) continue;
      const score = win.filter((t) => t.content).length * 2 + win.filter((t) => t.w.length >= 7).length;
      if (!best || score > best.score) best = { score, at: i, text: win.map((t) => doc.text.slice(t.start, t.end)).join(' ') };
    }
    if (best) cands.push(best);
  }
  // Best ones, then spread them over the article.
  return cands
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.at - b.at)
    .map((c) => c.text);
}
