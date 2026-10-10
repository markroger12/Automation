import { blocksToHtml, escapeHtml, splitSections, topBlocks, type Block, type Section } from './html';
import { FAQ_HEADING_RE, L, QUICK_BIO_HEADING_RE, isConclusionHeading, type Lang } from './language';
import { fullNameFromBio, type BioRow } from './parsers/quick-bio';
import type { Faq } from './parsers/faqs';

export type BodyImage = { key: string; src: string; alt: string };
export type InternalLink = { text: string; url: string; title: string };

export type AssemblyInput = {
  bodyHtml: string;
  keyword: string;
  language: Lang;
  kind: 'celebrity' | 'tigram';
  quickBio?: BioRow[];
  faqs?: Faq[];
  internalLink?: InternalLink | null;
  internalLinkText?: string;
  bodyImages?: BodyImage[];
};

export function isQuickBioSection(s: Section): boolean {
  return QUICK_BIO_HEADING_RE.test(s.heading.text) || s.blocks.some((b) => /class="[^"]*quick-bio-table/.test(b.html));
}

export function isFaqSection(s: Section): boolean {
  return FAQ_HEADING_RE.test(s.heading.text);
}

export function quickBioHtml(rows: BioRow[], keyword: string, language: Lang): string {
  if (!rows.length) return '';
  const t = L[language];
  const name = fullNameFromBio(rows, keyword);
  const body = rows.map((r) => `<tr><td><strong>${escapeHtml(r.label)}</strong></td><td>${escapeHtml(r.value)}</td></tr>`).join('');
  return `<h2>${escapeHtml(t.quickBioHeading(name))}</h2>\n<table class="quick-bio-table"><thead><tr><th>${t.attribute}</th><th>${t.details}</th></tr></thead><tbody>${body}</tbody></table>`;
}

export function faqHtml(faqs: Faq[], language: Lang): string {
  if (!faqs.length) return '';
  return `<h2>${escapeHtml(L[language].faqHeading)}</h2>\n` + faqs.map((f) => `<h3>${escapeHtml(f.question)}</h3>\n<p>${escapeHtml(f.answer)}</p>`).join('\n');
}

export function internalLinkHtml(link: InternalLink): string {
  return `<p><strong>${escapeHtml(link.text)} <a href="${escapeHtml(link.url)}">${escapeHtml(link.title)}</a></strong></p>`;
}

/** Recognises an internal-link line written earlier (to replace it instead of adding a second one). */
export function isInternalLinkBlock(b: Block, linkText?: string): boolean {
  if (b.tag !== 'p') return false;
  if (!/^<p>\s*<strong>[^<]*<a\s/i.test(b.html)) return false;
  const texts = [linkText, L.English.internalLinkText, L.German.internalLinkText, 'Also read', 'Read also', 'Lesen Sie auch', 'Auch lesenswert'].filter(Boolean) as string[];
  return texts.some((t) => b.text.toLowerCase().startsWith(t.replace(/:$/, '').toLowerCase()));
}

function figure(img: BodyImage): Block {
  const html = `<figure class="wp-block-image size-large bas-image" data-bas-image="${escapeHtml(img.key)}"><img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" data-bas-image="${escapeHtml(img.key)}"/></figure>`;
  return { tag: 'figure', html, text: '' };
}

/**
 * Body image 1: directly above the article's 2nd H2 — or above the 3rd H2 when the section above the 2nd H2 is
 * the Quick Bio. Never above the FAQs or the conclusion: then after the 2nd paragraph.
 * Body image 2: one paragraph before the FAQs.
 */
export function placeBodyImages(blocks: Block[], images: BodyImage[]): Block[] {
  if (!images.length) return blocks;
  const out = blocks.filter((b) => !(b.tag === 'figure' && /data-bas-image=/.test(b.html)));
  const h2 = () => out.map((b, i) => (b.tag === 'h2' ? i : -1)).filter((i) => i >= 0);
  const isFaqOrEnd = (i: number | undefined) => i === undefined || FAQ_HEADING_RE.test(out[i]!.text) || isConclusionHeading(out[i]!.text);
  const sectionIsBio = (start: number, end: number) => {
    const head = out[start]!;
    return QUICK_BIO_HEADING_RE.test(head.text) || out.slice(start, end).some((b) => /quick-bio-table/.test(b.html));
  };

  const [first, second] = images;
  if (first) {
    const hs = h2();
    let target = hs[1];
    if (target !== undefined && hs[0] !== undefined && sectionIsBio(hs[0], target)) target = hs[2];
    if (isFaqOrEnd(target)) {
      const paragraphs = out.map((b, i) => (b.tag === 'p' ? i : -1)).filter((i) => i >= 0);
      const after = paragraphs[1] ?? paragraphs[0];
      out.splice(after === undefined ? out.length : after + 1, 0, figure(first));
    } else {
      out.splice(target!, 0, figure(first));
    }
  }
  if (second) {
    const hs = h2();
    const faq = hs.find((i) => FAQ_HEADING_RE.test(out[i]!.text)) ?? hs.find((i) => isConclusionHeading(out[i]!.text)) ?? hs[hs.length - 1];
    if (faq !== undefined) {
      let p = faq - 1;
      while (p >= 0 && out[p]!.tag !== 'p') p--;
      // Not right next to the first image
      if (p > 0 && out[p - 1]?.tag !== 'figure' && out[p + 1]?.tag !== 'figure') out.splice(p, 0, figure(second));
      else if (p > 0) out.splice(p + 1, 0, figure(second));
    }
  }
  return out;
}

/**
 * Builds the final article: introduction → Quick Bio → sections → FAQs → conclusion → internal link (last line).
 * Headings for Quick Bio and FAQs are written by the app in the article language.
 */
export function assembleArticle(input: AssemblyInput): string {
  let blocks = topBlocks(input.bodyHtml).filter((b) => b.tag !== 'h1' && !isInternalLinkBlock(b, input.internalLinkText));
  const split = splitSections(blocks);
  const quickBio = input.quickBio ?? [];
  const faqs = input.faqs ?? [];

  let sections = split.sections;
  if (input.kind === 'celebrity') {
    sections = sections.filter((s) => !(quickBio.length && isQuickBioSection(s)) && !(faqs.length && isFaqSection(s)));
  }
  const last = sections[sections.length - 1];
  const conclusion = last && isConclusionHeading(last.heading.text) ? last : null;
  const middle = conclusion ? sections.slice(0, -1) : sections;
  const hasFaqSection = sections.some(isFaqSection);

  const parts: string[] = [];
  parts.push(blocksToHtml(split.intro));
  if (input.kind === 'celebrity' && quickBio.length) parts.push(quickBioHtml(quickBio, input.keyword, input.language));
  parts.push(blocksToHtml(middle.flatMap((s) => [s.heading, ...s.blocks])));
  if (faqs.length && (input.kind === 'celebrity' || !hasFaqSection)) parts.push(faqHtml(faqs, input.language));
  if (conclusion) parts.push(blocksToHtml([conclusion.heading, ...conclusion.blocks]));

  blocks = topBlocks(parts.filter(Boolean).join('\n'));
  blocks = placeBodyImages(blocks, input.bodyImages ?? []);
  let html = blocksToHtml(blocks);
  if (input.internalLink) html += `\n${internalLinkHtml(input.internalLink)}`;
  return html.trim();
}

/** Splits an article body into intro / sections / conclusion for other stages. */
export function articleOutline(bodyHtml: string) {
  const { intro, sections } = splitSections(topBlocks(bodyHtml));
  return { intro, sections, conclusion: sections.length && isConclusionHeading(sections[sections.length - 1]!.heading.text) ? sections[sections.length - 1]! : null };
}
