import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { topBlocks } from './html';

/** Converts article HTML into block-editor markup (paragraph, heading, list, table, image; anything else as an HTML block). */
export function htmlToBlocks(html: string): string {
  const out: string[] = [];
  for (const b of topBlocks(html)) {
    const $ = cheerio.load(b.html, null, false);
    const el = $.root().children().first();
    const inner = el.html() ?? '';
    switch (b.tag) {
      case 'p':
        out.push(`<!-- wp:paragraph -->\n<p>${inner}</p>\n<!-- /wp:paragraph -->`);
        break;
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = Number(b.tag[1]);
        const attrs = level === 2 ? '' : ` {"level":${level}}`;
        out.push(`<!-- wp:heading${attrs} -->\n<${b.tag} class="wp-block-heading">${inner}</${b.tag}>\n<!-- /wp:heading -->`);
        break;
      }
      case 'ul':
      case 'ol': {
        const items = el
          .children('li')
          .toArray()
          .map((li) => `<!-- wp:list-item -->\n<li>${$(li).html() ?? ''}</li>\n<!-- /wp:list-item -->`)
          .join('\n');
        out.push(`<!-- wp:list${b.tag === 'ol' ? ' {"ordered":true}' : ''} -->\n<${b.tag} class="wp-block-list">${items}</${b.tag}>\n<!-- /wp:list -->`);
        break;
      }
      case 'table': {
        const cls = (el.attr('class') ?? '').split(/\s+/).filter(Boolean);
        el.removeAttr('class');
        const attrs = JSON.stringify({ hasFixedLayout: false, ...(cls.length ? { className: cls.join(' ') } : {}) });
        out.push(`<!-- wp:table ${attrs} -->\n<figure class="wp-block-table${cls.length ? ` ${cls.join(' ')}` : ''}">${$.html(el)}</figure>\n<!-- /wp:table -->`);
        break;
      }
      case 'figure': {
        const img = el.find('img').first();
        if (img.length) {
          const id = Number(img.attr('data-id') ?? /wp-image-(\d+)/.exec(img.attr('class') ?? '')?.[1] ?? NaN);
          const src = img.attr('src') ?? '';
          const alt = img.attr('alt') ?? '';
          const attrs = JSON.stringify({ ...(Number.isFinite(id) ? { id } : {}), sizeSlug: 'large', linkDestination: 'none' });
          out.push(
            `<!-- wp:image ${attrs} -->\n<figure class="wp-block-image size-large"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${Number.isFinite(id) ? ` class="wp-image-${id}"` : ''}/></figure>\n<!-- /wp:image -->`,
          );
          break;
        }
        out.push(`<!-- wp:html -->\n${b.html}\n<!-- /wp:html -->`);
        break;
      }
      default:
        out.push(`<!-- wp:html -->\n${b.html}\n<!-- /wp:html -->`);
    }
  }
  return out.join('\n\n');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Replaces local article images (/api/media/…) with uploaded WordPress URLs and media ids. */
export function swapImageSources(html: string, map: Record<string, { id: number; url: string }>): string {
  const $ = cheerio.load(`<div id="__r">${html}</div>`);
  $('img').each((_, img) => {
    const el = $(img as Element);
    const hit = map[el.attr('src') ?? ''];
    if (!hit) return;
    el.attr('src', hit.url);
    el.attr('data-id', String(hit.id));
    el.addClass(`wp-image-${hit.id}`);
    el.removeAttr('data-bas-image');
  });
  $('figure[data-bas-image]').removeAttr('data-bas-image');
  return $('#__r').html() ?? html;
}

/** Removes block comments (to compare or re-edit content that was saved as blocks). */
export function stripBlockComments(html: string): string {
  return html.replace(/<!--\s*\/?wp:[^>]*-->\s*/g, '').trim();
}
