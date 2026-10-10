import sanitizeHtml from 'sanitize-html';

/** Allow-list for article HTML (on save and before display). */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'figure', 'figcaption', 'img', 'code', 'pre', 'span', 'sup', 'sub', 'div'],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'class', 'data-bas-image', 'data-id'],
    figure: ['class', 'data-bas-image'],
    table: ['class'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    p: ['class'],
    div: ['class'],
    span: ['class'],
    h2: ['id'],
    h3: ['id'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const out: Record<string, string> = { href: attribs.href ?? '' };
      if (attribs.title) out.title = attribs.title;
      if (attribs.target === '_blank') {
        out.target = '_blank';
        out.rel = attribs.rel && /noopener/.test(attribs.rel) ? attribs.rel : 'noopener';
      } else if (attribs.rel) out.rel = attribs.rel;
      return { tagName, attribs: out };
    },
  },
  exclusiveFilter: (frame) => frame.tag === 'p' && !frame.text.trim() && !(frame.mediaChildren ?? []).length,
};

export function sanitizeArticleHtml(html: string): string {
  // Local media are served from /api/media/… — keep those relative image URLs.
  const relImg = /src="\/api\/media\//g;
  const prepared = html.replace(relImg, 'src="https://local.media/api/media/');
  return sanitizeHtml(prepared, OPTIONS).replace(/src="https:\/\/local\.media\/api\/media\//g, 'src="/api/media/');
}
