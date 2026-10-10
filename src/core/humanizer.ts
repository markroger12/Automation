import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { escapeHtml, topBlocks, type Block } from './html';
import { countKeyword, countWords, sentences, words } from './text';
import type { Lang } from './language';

/** Editorial rewrite with fact locks — not a detector bypass. Pure helpers shared by the stage and the test page. */

export type LinkMark = { n: number; href: string; anchor: string; target?: string; rel?: string };
export type Encoded = { text: string; links: LinkMark[] };

/** Paragraph HTML → text with marks: {L1}anchor{/L1}, {b}…{/b}, {i}…{/i}. */
export function encodeParagraph(html: string): Encoded {
  const $ = cheerio.load(`<div id="__r">${html}</div>`);
  const links: LinkMark[] = [];
  const walk = (nodes: AnyNode[]): string =>
    nodes
      .map((node) => {
        if (node.type === 'text') return (node as unknown as { data: string }).data;
        if (node.type !== 'tag') return '';
        const el = node as Element;
        const inner = walk(el.children as AnyNode[]);
        if (el.name === 'a') {
          const n = links.length + 1;
          links.push({ n, href: $(el).attr('href') ?? '', anchor: $(el).text(), target: $(el).attr('target'), rel: $(el).attr('rel') });
          return `{L${n}}${inner}{/L${n}}`;
        }
        if (el.name === 'strong' || el.name === 'b') return inner.trim() ? `{b}${inner}{/b}` : inner;
        if (el.name === 'em' || el.name === 'i') return inner.trim() ? `{i}${inner}{/i}` : inner;
        if (el.name === 'br') return ' ';
        return inner;
      })
      .join('');
  const root = $('#__r').children().first();
  const nodes = root.length && root[0]!.type === 'tag' && (root[0] as Element).name === 'p' ? ((root[0] as Element).children as AnyNode[]) : ($('#__r')[0] as Element).children as AnyNode[];
  return { text: walk(nodes).replace(/\s+/g, ' ').trim(), links };
}

/** Removes backslash escapes and turns stray Markdown bold/italic into marks. */
export function cleanAnswerParagraph(text: string): string {
  return text
    .replace(/\\([^\w\s])/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '{b}$1{/b}')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1{i}$2{/i}')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text with marks → paragraph HTML (original link targets kept). */
export function decodeParagraph(text: string, links: LinkMark[]): string {
  let html = escapeHtml(text);
  for (const l of links) {
    const attrs = [`href="${escapeHtml(l.href)}"`, l.target ? `target="${escapeHtml(l.target)}"` : '', l.rel ? `rel="${escapeHtml(l.rel)}"` : ''].filter(Boolean).join(' ');
    html = html.replace(new RegExp(`\\{L${l.n}\\}([\\s\\S]*?)\\{/L${l.n}\\}`), `<a ${attrs}>$1</a>`);
  }
  html = html.replace(/\{b\}([\s\S]*?)\{\/b\}/g, '<strong>$1</strong>').replace(/\{i\}([\s\S]*?)\{\/i\}/g, '<em>$1</em>');
  html = html.replace(/\{\/?(L\d+|b|i)\}/g, '');
  return `<p>${html}</p>`;
}

export function plainOf(marked: string): string {
  return marked.replace(/\{\/?(L\d+|b|i)\}/g, '');
}

// ---------------- analyser ----------------

const FILLER_EN = ['it is important to note', 'it is worth noting', 'it should be noted', 'this highlights', 'in conclusion', 'plays a crucial role', 'plays a pivotal role', "in today's fast-paced world", 'a testament to', 'when it comes to', 'at the end of the day', 'all in all', 'it goes without saying', 'needless to say', 'stands as', 'serves as a reminder'];
const FILLER_DE = ['es ist wichtig zu beachten', 'es ist erwähnenswert', 'zusammenfassend lässt sich sagen', 'spielt eine entscheidende rolle', 'in der heutigen schnelllebigen welt', 'nicht zuletzt', 'es lässt sich festhalten', 'ein zeugnis für'];
const INFLATED_EN = ['delve', 'delves', 'pivotal', 'intricate', 'meticulous', 'meticulously', 'underscore', 'underscores', 'showcase', 'showcases', 'showcasing', 'testament', 'tapestry', 'realm', 'vibrant', 'embark', 'embarked', 'navigate', 'navigating', 'leverage', 'foster', 'fostering', 'crucial', 'remarkable', 'remarkably', 'renowned', 'boasts', 'unparalleled', 'seamless', 'multifaceted', 'groundbreaking'];
const INFLATED_DE = ['bemerkenswert', 'bemerkenswerte', 'entscheidend', 'entscheidende', 'facettenreich', 'facettenreiche', 'maßgeblich', 'unvergleichlich', 'beeindruckend', 'beeindruckende', 'vielschichtig', 'wegweisend'];
const OPENERS_EN = ['additionally', 'furthermore', 'moreover', 'notably', 'overall', 'ultimately', 'consequently', 'importantly'];
const OPENERS_DE = ['darüber hinaus', 'außerdem', 'zudem', 'letztendlich', 'insgesamt', 'des weiteren', 'ferner'];

export type ParagraphAnalysis = { problems: string[]; signals: number; words: number };

export function analyzeParagraph(text: string, lang: Lang): ParagraphAnalysis {
  const lower = text.toLowerCase();
  const problems: string[] = [];
  let signals = 0;
  const filler = (lang === 'German' ? [...FILLER_DE, ...FILLER_EN] : FILLER_EN).filter((f) => lower.includes(f));
  if (filler.length) {
    problems.push(`filler: ${filler.map((f) => `"${f}"`).join(', ')}`);
    signals += filler.length;
  }
  const wl = words(lower);
  const inflatedList = lang === 'German' ? [...INFLATED_DE, ...INFLATED_EN] : INFLATED_EN;
  const inflated = [...new Set(wl.filter((w) => inflatedList.includes(w)))];
  if (inflated.length) {
    problems.push(`inflated words: ${inflated.join(', ')}`);
    signals += wl.filter((w) => inflatedList.includes(w)).length;
  }
  const openersList = lang === 'German' ? OPENERS_DE : OPENERS_EN;
  const openers = sentences(text)
    .map((s) => s.toLowerCase())
    .filter((s) => openersList.some((o) => s.startsWith(o + ',') || s.startsWith(o + ' ')));
  if (openers.length) {
    problems.push(`starts sentences with ${[...new Set(openers.map((s) => s.split(/[ ,]/)[0]))].join('/')}`);
    signals += openers.length;
  }
  const dashes = (text.match(/[—–]/g) ?? []).length;
  if (dashes >= 2) {
    problems.push(`${dashes} dashes`);
    signals += dashes - 1;
  }
  const long = sentences(text).filter((s) => countWords(s) > 35).length;
  if (long) problems.push(`${long} very long sentence(s)`);
  return { problems, signals, words: countWords(text) };
}

export type Rhythm = { sentences: number; mean: number; cv: number };

/** Sentence rhythm: coefficient of variation of sentence lengths (low = too even). */
export function sentenceRhythm(texts: string[]): Rhythm {
  const lens = texts.flatMap((t) => sentences(t)).map((s) => countWords(s)).filter((n) => n > 0);
  if (lens.length < 2) return { sentences: lens.length, mean: lens[0] ?? 0, cv: 0 };
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  return { sentences: lens.length, mean: Math.round(mean * 10) / 10, cv: Math.round((sd / mean) * 100) / 100 };
}

/** Article-wide notes: repeated sentence openers and sentence lengths that are too even. */
export function articleNotes(texts: string[], lang: Lang): string[] {
  const notes: string[] = [];
  const firstWords = texts.flatMap((t) => sentences(t)).map((s) => (s.split(/\s+/)[0] ?? '').toLowerCase().replace(/[^\p{L}]/gu, '')).filter(Boolean);
  const counts = new Map<string, number>();
  for (const w of firstWords) counts.set(w, (counts.get(w) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([w, n]) => n >= Math.max(4, firstWords.length * 0.12) && !['the', 'der', 'die', 'das'].includes(w)).map(([w, n]) => `"${w}" (${n}×)`);
  if (repeated.length) notes.push(`Many sentences start with the same word: ${repeated.join(', ')}. Vary the openings.`);
  const r = sentenceRhythm(texts);
  if (r.sentences >= 8 && r.cv < 0.35) notes.push(`Sentence lengths are too even (about ${Math.round(r.mean)} words each). Mix short and longer sentences.`);
  void lang;
  return notes;
}

export function signalDensity(texts: string[], lang: Lang): number {
  let signals = 0;
  let total = 0;
  for (const t of texts) {
    const a = analyzeParagraph(t, lang);
    signals += a.signals;
    total += a.words;
  }
  return total ? Math.round((signals / total) * 1000) / 10 : 0;
}

// ---------------- parts & answers ----------------

export type HumanParagraph = { n: number; blockIndex: number; html: string; encoded: Encoded; analysis: ParagraphAnalysis };

export function splitIntoParts(paragraphs: HumanParagraph[], maxWords = 1200): HumanParagraph[][] {
  const parts: HumanParagraph[][] = [];
  let cur: HumanParagraph[] = [];
  let count = 0;
  for (const p of paragraphs) {
    if (cur.length && count + p.analysis.words > maxWords) {
      parts.push(cur);
      cur = [];
      count = 0;
    }
    cur.push(p);
    count += p.analysis.words;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

export function paragraphsBlock(part: HumanParagraph[]): string {
  return part.map((p) => `[P${p.n}]\n${p.encoded.text}`).join('\n\n');
}

export function problemsBlock(part: HumanParagraph[], notes: string[]): string {
  const lines = part.filter((p) => p.analysis.problems.length).map((p) => `[P${p.n}]: ${p.analysis.problems.join('; ')}`);
  return [...(lines.length ? lines : ['No specific problems found; improve flow and variety.']), ...notes.map((n) => `Whole article: ${n}`)].join('\n');
}

/** "[P4]" label lines followed by the paragraph. */
export function parseLabeledAnswer(text: string): Map<number, string> {
  const out = new Map<number, string>();
  let cur: number | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur !== null && buf.join(' ').trim()) out.set(cur, cleanAnswerParagraph(buf.join(' ')));
    buf = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(?:\*\*)?\[?P(\d{1,3})\]?(?:\*\*)?\s*[:.]?\s*(.*)$/i.exec(line);
    if (m && (/^\[|^\*\*\[/.test(line) || /^P\d+[:.]/i.test(line))) {
      flush();
      cur = Number(m[1]);
      if (m[2]) buf.push(m[2]);
      continue;
    }
    if (cur !== null && line) buf.push(line);
  }
  flush();
  return out;
}

// ---------------- fact locks ----------------

const NAME_STOP = new Set(['unlike', 'because', 'after', 'when', 'while', 'in', 'on', 'at', 'the', 'this', 'that', 'these', 'those', 'her', 'his', 'she', 'he', 'they', 'it', 'its', 'despite', 'although', 'though', 'as', 'with', 'from', 'for', 'during', 'before', 'since', 'through', 'by', 'and', 'but', 'a', 'an', 'today', 'later', 'now', 'then', 'also', 'both', 'like', 'besides', 'beyond', 'within', 'without', 'into', 'once', 'if', 'over', 'under', 'between', 'among', 'about', 'apart', 'aside', 'every', 'each', 'many', 'some', 'most', 'all', 'one', 'two', 'three', 'here', 'there', 'what', 'why', 'how', 'who', 'where', 'yes', 'no',
  'anders', 'weil', 'nach', 'wenn', 'während', 'im', 'in', 'am', 'an', 'auf', 'der', 'die', 'das', 'dieser', 'diese', 'dieses', 'sie', 'er', 'es', 'trotz', 'obwohl', 'als', 'mit', 'von', 'vom', 'für', 'vor', 'seit', 'durch', 'bei', 'und', 'aber', 'ein', 'eine', 'einen', 'heute', 'später', 'jetzt', 'dann', 'auch', 'beide', 'wie', 'neben', 'zur', 'zum', 'zu', 'ihr', 'ihre', 'sein', 'seine', 'unter', 'über', 'zwischen']);

/** Multi-word names: 2+ capitalised words in a row (sentence openers such as "Unlike X" are not part of the name). */
export function multiWordNames(text: string): string[] {
  const plain = plainOf(text);
  const out = new Set<string>();
  const re = /(?:\p{Lu}[\p{L}'’-]*)(?:\s+(?:\p{Lu}[\p{L}'’-]*|of|de|van|von|der|da|del|la|le|du))+/gu;
  for (const m of plain.matchAll(re)) {
    const parts = m[0].split(/\s+/);
    while (parts.length && NAME_STOP.has(parts[0]!.toLowerCase().replace(/[^\p{L}]/gu, ''))) parts.shift();
    while (parts.length && /^(of|de|van|von|der|da|del|la|le|du)$/.test(parts[parts.length - 1]!)) parts.pop();
    if (parts.length >= 2) out.add(parts.join(' ').replace(/['’]s$/, ''));
  }
  return [...out];
}

function numbersOf(text: string): string[] {
  return (plainOf(text).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, '')).sort();
}

function quotesOf(text: string): string[] {
  return [...plainOf(text).matchAll(/["“„«]([^"”“«»]{3,200})["”“»]/g)].map((m) => m[1]!.trim());
}

function linkMarks(text: string): string[] {
  return [...text.matchAll(/\{L(\d+)\}([\s\S]*?)\{\/L\1\}/g)].map((m) => `${m[1]}:${m[2]!.trim().toLowerCase()}`).sort();
}

export type LockResult = { ok: boolean; reason?: string; warnings: string[] };

export function checkLocks(original: string, rewritten: string, keyword: string, lang: Lang): LockResult {
  const warnings: string[] = [];
  const a = linkMarks(original);
  const b = linkMarks(rewritten);
  if (a.join('|') !== b.join('|')) return { ok: false, reason: 'links changed', warnings };
  const na = numbersOf(original);
  const nb = numbersOf(rewritten);
  if (na.join('|') !== nb.join('|')) return { ok: false, reason: `numbers changed (${na.join(', ') || 'none'} → ${nb.join(', ') || 'none'})`, warnings };
  const plainB = plainOf(rewritten);
  for (const q of quotesOf(original)) if (!plainB.includes(q)) return { ok: false, reason: `quote changed: “${q.slice(0, 40)}”`, warnings };
  const lowerB = plainB.toLowerCase();
  const kwWords = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  for (const name of multiWordNames(original)) {
    const parts = name.toLowerCase().split(/\s+/);
    if (parts.every((p) => new RegExp(`(?<![\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(lowerB))) continue; // reordered words are accepted
    if (lang === 'German') {
      const kwInName = parts.filter((p) => kwWords.includes(p));
      if (kwInName.length && kwInName.every((p) => !lowerB.includes(p))) return { ok: false, reason: `name lost: ${name}`, warnings };
      warnings.push(`reworded: ${name}`);
      continue;
    }
    return { ok: false, reason: `name lost: ${name}`, warnings };
  }
  if (countKeyword(plainOf(original), keyword) !== countKeyword(plainB, keyword)) return { ok: false, reason: 'keyword count changed', warnings };
  const wa = countWords(plainOf(original));
  const wb = countWords(plainB);
  const ratio = wa ? wb / wa : 1;
  if (ratio < 0.6 || ratio > 1.3) return { ok: false, reason: `length changed ${Math.round(ratio * 100)}%`, warnings };
  return { ok: true, warnings };
}

// ---------------- whole-article helpers ----------------

export function humanizableParagraphs(html: string, lang: Lang, isExcluded: (b: Block) => boolean): { blocks: Block[]; paragraphs: HumanParagraph[] } {
  const blocks = topBlocks(html);
  const paragraphs: HumanParagraph[] = [];
  blocks.forEach((b, i) => {
    if (b.tag !== 'p' || isExcluded(b) || /<img/i.test(b.html)) return;
    const encoded = encodeParagraph(b.html);
    if (countWords(plainOf(encoded.text)) < 12) return;
    paragraphs.push({ n: paragraphs.length + 1, blockIndex: i, html: b.html, encoded, analysis: analyzeParagraph(plainOf(encoded.text), lang) });
  });
  return { blocks, paragraphs };
}
