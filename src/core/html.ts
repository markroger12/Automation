import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type Block = { tag: string; html: string; text: string };

/** Top-level blocks of an HTML fragment (text nodes between blocks become paragraphs). */
export function topBlocks(html: string): Block[] {
  const $ = cheerio.load(`<div id="__r">${html}</div>`);
  const out: Block[] = [];
  for (const node of $('#__r').contents().toArray() as AnyNode[]) {
    if (node.type === 'text') {
      const t = $(node).text().trim();
      if (t) out.push({ tag: 'p', html: `<p>${escapeHtml(t)}</p>`, text: t });
      continue;
    }
    if (node.type !== 'tag') continue;
    const el = node as Element;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (el.name === 'p' && !text && !$(el).find('img').length) continue;
    out.push({ tag: el.name.toLowerCase(), html: $.html(el), text });
  }
  return out;
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks.map((b) => b.html).join('\n');
}

export type Section = { heading: Block; blocks: Block[] };
export type SplitArticle = { intro: Block[]; sections: Section[] };

export function splitSections(blocks: Block[]): SplitArticle {
  const intro: Block[] = [];
  const sections: Section[] = [];
  for (const b of blocks) {
    if (b.tag === 'h2') sections.push({ heading: b, blocks: [] });
    else if (sections.length) sections[sections.length - 1]!.blocks.push(b);
    else intro.push(b);
  }
  return { intro, sections };
}

export function joinSections(a: SplitArticle): Block[] {
  return [...a.intro, ...a.sections.flatMap((s) => [s.heading, ...s.blocks])];
}

/** Paragraph-like blocks (p, li, td, blockquote) used for link placement and the humanizer. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="__r">${html}</div>`);
  $('br').replaceWith('\n');
  $('p,h1,h2,h3,h4,h5,h6,li,tr,blockquote,figure').each((_, el) => {
    $(el).append('\n');
  });
  return $('#__r').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function countTag(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length;
}

/** Simple well-formedness check for the tags articles use. Returns the problems found. */
export function htmlProblems(html: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'col']);
  const re = /<\/?([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1]!.toLowerCase();
    if (voidTags.has(tag) || m[2] === '/') continue;
    if (m[0].startsWith('</')) {
      const idx = stack.lastIndexOf(tag);
      if (idx < 0) problems.push(`Unexpected </${tag}>`);
      else {
        for (const open of stack.splice(idx)) if (open !== tag) problems.push(`<${open}> is not closed`);
      }
    } else stack.push(tag);
  }
  for (const open of stack) if (!['p', 'li', 'td', 'th', 'tr'].includes(open)) problems.push(`<${open}> is not closed`);
  if (/<(script|iframe|object|embed|style)\b/i.test(html)) problems.push('Contains script/iframe/style tags');
  return problems.slice(0, 10);
}
