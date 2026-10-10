import { plainLine, stripQuotes } from './common';
import { parseQuickBio, type BioRow } from './quick-bio';
import { parseFaqs, type Faq } from './faqs';

/**
 * Reads the labelled OUTPUT FORMAT of the Celebrity Writer 2.0 prompt. Labels may be numbered, bold or headings,
 * with the value on the same line or the next. The owner's prompt is never changed — this parser adapts to it.
 */
export type Writer2Result = {
  title: string | null;
  body: string;
  quickBio: BioRow[];
  faqs: Faq[];
  metaDescription: string | null;
  slug: string | null;
  tags: string[];
  anchors: string[];
  researchNotes: string;
  labelsFound: string[];
};

type Kind = 'title' | 'intro' | 'quickbio' | 'main' | 'faqs' | 'final' | 'meta' | 'slug' | 'tags' | 'anchors' | 'research';

const LABELS: { kind: Kind; re: RegExp }[] = [
  { kind: 'title', re: /^(?:h1\s*(?:\/|–|-|or)\s*)?(?:article\s+)?title(?:\s*\(h1\))?$|^h1$|^seo[- ]?title$|^titel$|^überschrift$/i },
  { kind: 'intro', re: /^intro(?:duction)?$|^einleitung$/i },
  { kind: 'quickbio', re: /^quick\s*bio(?:\s*table)?$|^quick\s*facts(?:\s*table)?$|^kurzbiografie(?:\s*tabelle)?$|^steckbrief$/i },
  { kind: 'main', re: /^main\s+article(?:\s+body)?$|^article\s+body$|^main\s+body$|^body$|^hauptteil$|^artikel$/i },
  { kind: 'faqs', re: /^(?:(?:five|5|\d+)\s+)?faqs?$|^frequently\s+asked\s+questions$|^häufig gestellte fragen$/i },
  { kind: 'final', re: /^final\s+thoughts$|^conclusion$|^fazit$|^schlussgedanken$/i },
  { kind: 'meta', re: /^meta\s*description$|^meta-beschreibung$/i },
  { kind: 'slug', re: /^(?:suggested\s+)?(?:url\s+)?slug$|^url$/i },
  { kind: 'tags', re: /^(?:\d+\s*[–-]\s*\d+\s+)?tags$|^schlagwörter$/i },
  { kind: 'anchors', re: /^internal[- ]link\s+anchors?(?:\s+texts?)?$|^anchor\s+texts?$/i },
  { kind: 'research', re: /^research\s+notes$|^sources$|^quellen$|^recherche(?:notizen)?$/i },
];

/** "**3. Quick Bio table:** value" → { kind, rest } */
export function matchLabel(line: string): { kind: Kind; rest: string; label: string } | null {
  const cleaned = line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^(?:step\s*)?\d{1,2}\s*[.)]\s*/i, '')
    .replace(/\*\*/g, '')
    .trim();
  const m = /^([^:：]{2,60}?)\s*(?:[:：]\s*(.*))?$/.exec(cleaned);
  if (!m) return null;
  const label = m[1]!.trim().replace(/\s*\(.*?\)\s*$/, '');
  const hit = LABELS.find((l) => l.re.test(label));
  if (!hit) return null;
  // A heading like "## Final Thoughts" without colon is a label; a long sentence is not.
  if (!m[2] && !/[:：]\s*$/.test(cleaned) && !/^#{1,6}\s/.test(line.trim()) && !/^\*\*|^\d{1,2}[.)]/.test(line.trim())) return null;
  return { kind: hit.kind, rest: (m[2] ?? '').trim(), label };
}

function splitList(text: string): string[] {
  return text
    .split(/\n|,|;|•/)
    .map((t) => plainLine(t).replace(/^#/, '').trim())
    .map((t) => stripQuotes(t))
    .filter((t) => t.length > 1 && t.length < 60);
}

export function parseWriter2(markdown: string): Writer2Result {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: { kind: Kind; label: string; lines: string[] }[] = [];
  let current: { kind: Kind; label: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = matchLabel(line);
    if (m && !(current && current.kind === m.kind && m.kind === 'main')) {
      current = { kind: m.kind, label: m.label, lines: m.rest ? [m.rest] : [] };
      sections.push(current);
      continue;
    }
    // Prose before the first label (ChatGPT preamble) is dropped.
    if (current) current.lines.push(line);
  }
  const text = (k: Kind) => sections.filter((s) => s.kind === k).map((s) => s.lines.join('\n').trim()).filter(Boolean).join('\n\n');
  const result: Writer2Result = {
    title: null,
    body: '',
    quickBio: [],
    faqs: [],
    metaDescription: null,
    slug: null,
    tags: [],
    anchors: [],
    researchNotes: text('research'),
    labelsFound: sections.map((s) => s.kind),
  };

  if (!sections.length) {
    // No labels at all: use the whole answer; the title is the first H1.
    const h1 = /^\s*#\s+(.+)$/m.exec(markdown);
    result.title = h1 ? plainLine(h1[1]!) : null;
    result.body = markdown.replace(/^\s*#\s+.+$/m, '').trim();
    return result;
  }

  const titleText = text('title');
  result.title = titleText ? stripQuotes(plainLine(titleText.split('\n').find((l) => l.trim()) ?? '')) || null : null;

  const parts: string[] = [];
  const intro = text('intro');
  if (intro) parts.push(intro);
  const main = text('main');
  if (main) parts.push(main);
  const final = sections.find((s) => s.kind === 'final');
  if (final) {
    const body = final.lines.join('\n').trim();
    const heading = /^final\s+thoughts$/i.test(final.label) ? 'Final Thoughts' : /^fazit$/i.test(final.label) ? 'Fazit' : final.label;
    // The section may already start with its own heading.
    parts.push(/^#{2,3}\s/.test(body) ? body : `## ${heading}\n\n${body}`);
  }
  result.body = parts.join('\n\n').replace(/^\s*#\s+.+\n/, '').trim();

  const bio = text('quickbio');
  if (bio) result.quickBio = parseQuickBio(bio);
  const faqs = text('faqs');
  if (faqs) result.faqs = parseFaqs(faqs);
  const meta = text('meta');
  if (meta) result.metaDescription = stripQuotes(plainLine(meta.split('\n').find((l) => l.trim()) ?? '')) || null;
  const slug = text('slug');
  if (slug) result.slug = plainLine(slug.split('\n').find((l) => l.trim()) ?? '').replace(/^https?:\/\/[^/]+\//, '').replace(/^\/|\/$/g, '') || null;
  const tags = text('tags');
  if (tags) result.tags = [...new Set(splitList(tags))].slice(0, 12);
  const anchors = text('anchors');
  if (anchors) result.anchors = splitList(anchors);
  return result;
}
