import { marked } from 'marked';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

marked.setOptions({ gfm: true, breaks: false });

export function markdownToHtml(markdown: string): string {
  return (marked.parse(markdown, { async: false }) as string).trim();
}

function inline($: cheerio.CheerioAPI, nodes: AnyNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += (node as unknown as { data: string }).data.replace(/\s+/g, ' ');
      continue;
    }
    if (node.type !== 'tag') continue;
    const el = node as Element;
    const inner = inline($, el.children as AnyNode[]);
    switch (el.name) {
      case 'strong':
      case 'b':
        out += inner.trim() ? `**${inner.trim()}**` : '';
        break;
      case 'em':
      case 'i':
        out += inner.trim() ? `*${inner.trim()}*` : '';
        break;
      case 'a': {
        const href = $(el).attr('href');
        out += href && /^https?:/i.test(href) ? `[${inner.trim()}](${href})` : inner;
        break;
      }
      case 'br':
        out += '\n';
        break;
      case 'code':
        out += `\`${inner}\``;
        break;
      case 'img': {
        const src = $(el).attr('src');
        out += src ? `![${$(el).attr('alt') ?? ''}](${src})` : '';
        break;
      }
      case 'sup':
        // ChatGPT citation pills render as superscripts
        break;
      default:
        out += inner;
    }
  }
  return out;
}

function tableToMarkdown($: cheerio.CheerioAPI, table: Element): string {
  const rows: string[][] = [];
  $(table)
    .find('tr')
    .each((_, tr) => {
      const cells: string[] = [];
      $(tr)
        .children('th,td')
        .each((__, cell) => {
          cells.push(inline($, (cell as Element).children as AnyNode[]).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim());
        });
      if (cells.length) rows.push(cells);
    });
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const lines = [`| ${pad(rows[0]!).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
  for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(' | ')} |`);
  return lines.join('\n');
}

function blockToMarkdown($: cheerio.CheerioAPI, node: AnyNode): string {
  if (node.type === 'text') return (node as unknown as { data: string }).data.trim();
  if (node.type !== 'tag') return '';
  const el = node as Element;
  const name = el.name;
  if (/^h[1-6]$/.test(name)) return `${'#'.repeat(Number(name[1]))} ${inline($, el.children as AnyNode[]).trim()}`;
  if (name === 'p') return inline($, el.children as AnyNode[]).trim();
  if (name === 'ul' || name === 'ol') {
    let i = 0;
    return $(el)
      .children('li')
      .map((_, li) => `${name === 'ol' ? `${++i}.` : '-'} ${inline($, (li as Element).children as AnyNode[]).trim()}`)
      .get()
      .join('\n');
  }
  if (name === 'table') return tableToMarkdown($, el);
  if (name === 'blockquote') return blockChildren($, el).split('\n').map((l) => `> ${l}`).join('\n');
  if (name === 'pre') return '```\n' + $(el).text().trim() + '\n```';
  if (name === 'hr') return '---';
  if (name === 'br') return '';
  if (['div', 'section', 'article', 'main', 'figure', 'span'].includes(name)) return blockChildren($, el);
  return inline($, [el]).trim();
}

function blockChildren($: cheerio.CheerioAPI, el: Element): string {
  const parts: string[] = [];
  let inlineBuf: AnyNode[] = [];
  const flush = () => {
    const t = inline($, inlineBuf).trim();
    if (t) parts.push(t);
    inlineBuf = [];
  };
  for (const child of el.children as AnyNode[]) {
    const isBlock = child.type === 'tag' && /^(h[1-6]|p|ul|ol|table|blockquote|pre|hr|div|section|article|figure|main)$/.test((child as Element).name);
    if (isBlock) {
      flush();
      const md = blockToMarkdown($, child);
      if (md) parts.push(md);
    } else inlineBuf.push(child);
  }
  flush();
  return parts.join('\n\n');
}

/** HTML from the ChatGPT page → Markdown, so every answer is parsed the same way. */
export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  const root = $('#__root')[0] as Element;
  return blockChildren($, root).replace(/\n{3,}/g, '\n\n').trim();
}

/** One Markdown text for every ChatGPT answer: the conversation reader gives Markdown, the page reader gives HTML. */
export function normalizeAnswer(answer: { text: string; html?: string | null }): string {
  const html = answer.html?.trim();
  if (html && /<(h[1-6]|p|table|ul|ol|strong)\b/i.test(html)) {
    const md = htmlToMarkdown(html);
    if (md.length >= answer.text.trim().length * 0.5) return md;
  }
  return answer.text.replace(/\r\n/g, '\n').trim();
}
