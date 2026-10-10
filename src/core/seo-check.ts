import { countTag, htmlProblems, htmlToText, splitSections, topBlocks } from './html';
import { containsKeyword, countKeyword, countWords, keywordDensity, slugify } from './text';
import { FAQ_HEADING_RE, QUICK_BIO_HEADING_RE } from './language';

export type SeoCheck = { id: string; label: string; passed: boolean; weight: number; detail: string };
export type SeoReport = { score: number; checks: SeoCheck[]; metrics: SeoMetrics };
export type SeoMetrics = { wordCount: number; keywordCount: number; keywordDensity: number; h2Count: number; h3Count: number; paragraphs: number; longestParagraph: number };

export type SeoInput = {
  keyword: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  contentHtml: string;
  kind: 'celebrity' | 'tigram';
  maxWords: number;
  minKeyword: number;
  maxKeyword: number;
  hasFaqs: boolean;
  hasQuickBio: boolean;
  category: string | null;
  tags: string[];
};

/** The internal "SEO Readiness Score": weighted percentage of passed checks. */
export function seoCheck(input: SeoInput): SeoReport {
  const html = input.contentHtml;
  const text = htmlToText(html);
  const blocks = topBlocks(html);
  const paragraphs = blocks.filter((b) => b.tag === 'p' && b.text.length > 0);
  const { intro } = splitSections(blocks);
  const introText = (intro.length ? intro : paragraphs.slice(0, 1)).map((b) => b.text).join(' ');
  const first100 = text.split(/\s+/).slice(0, 100).join(' ');
  const headings = blocks.filter((b) => b.tag === 'h2' || b.tag === 'h3');
  const kwCount = countKeyword(text, input.keyword);
  const words = countWords(text);
  const density = keywordDensity(text, input.keyword);
  const h2 = countTag(html, 'h2');
  const h3 = countTag(html, 'h3');
  const paraWords = paragraphs.map((p) => countWords(p.text));
  const longest = paraWords.length ? Math.max(...paraWords) : 0;
  const normParas = paragraphs.map((p) => p.text.toLowerCase().replace(/\s+/g, ' ').trim()).filter((t) => t.length > 40);
  const dupes = normParas.length - new Set(normParas).size;
  const stuffed = paragraphs.filter((p) => countKeyword(p.text, input.keyword) > 3 && countWords(p.text) < 120).length;
  const emptyHeadings = headings.filter((h) => !h.text.trim()).length;
  const problems = htmlProblems(html);
  const slugKw = slugify(input.keyword);
  const metaLen = input.metaDescription.trim().length;
  const hasFaqContent = input.hasFaqs || blocks.some((b) => b.tag === 'h2' && FAQ_HEADING_RE.test(b.text));
  const hasBioContent = input.hasQuickBio || blocks.some((b) => (b.tag === 'h2' && QUICK_BIO_HEADING_RE.test(b.text)) || /quick-bio-table/.test(b.html));

  const checks: SeoCheck[] = [
    { id: 'kw-title', label: 'Keyword in the title', weight: 10, passed: containsKeyword(input.title, input.keyword), detail: input.title },
    { id: 'kw-seo-title', label: 'Keyword in the SEO title', weight: 8, passed: containsKeyword(input.seoTitle, input.keyword), detail: input.seoTitle },
    { id: 'kw-slug', label: 'Keyword in the slug', weight: 6, passed: !!slugKw && input.slug.includes(slugKw), detail: input.slug },
    { id: 'kw-intro', label: 'Keyword in the introduction', weight: 8, passed: containsKeyword(introText, input.keyword) || containsKeyword(first100, input.keyword), detail: 'First paragraph / first 100 words' },
    { id: 'kw-body', label: 'Keyword in the body', weight: 4, passed: kwCount > 0, detail: `${kwCount} uses` },
    { id: 'kw-heading', label: 'Keyword in a relevant heading', weight: 6, passed: headings.some((h) => containsKeyword(h.text, input.keyword)), detail: `${headings.length} headings` },
    {
      id: 'kw-frequency',
      label: `Keyword used ${input.minKeyword}–${input.maxKeyword} times`,
      weight: 8,
      passed: kwCount >= input.minKeyword && kwCount <= input.maxKeyword,
      detail: `${kwCount} uses`,
    },
    { id: 'kw-density', label: 'Keyword density 0.5–2.5%', weight: 6, passed: density >= 0.5 && density <= 2.5, detail: `${density}%` },
    {
      id: 'word-count',
      label: `Word count up to ${input.maxWords}`,
      weight: 8,
      passed: words <= Math.round(input.maxWords * 1.1) && words >= Math.round(input.maxWords * 0.5),
      detail: `${words} words`,
    },
    { id: 'meta-length', label: 'Meta description 120–160 characters with the keyword', weight: 8, passed: metaLen >= 120 && metaLen <= 160 && containsKeyword(input.metaDescription, input.keyword), detail: `${metaLen} characters` },
    { id: 'title-length', label: 'SEO title up to 60 characters', weight: 4, passed: input.seoTitle.length > 0 && input.seoTitle.length <= 60, detail: `${input.seoTitle.length} characters` },
    { id: 'h2-count', label: 'At least 3 H2 headings', weight: 5, passed: h2 >= 3, detail: `${h2} H2` },
    { id: 'h3-count', label: 'Uses H3 sub-headings', weight: 2, passed: h3 >= 1, detail: `${h3} H3` },
    { id: 'paragraph-length', label: 'No paragraph longer than 150 words', weight: 4, passed: longest <= 150, detail: `longest ${longest} words` },
    { id: 'faqs', label: 'FAQs exist', weight: 5, passed: hasFaqContent, detail: hasFaqContent ? 'yes' : 'missing' },
    ...(input.kind === 'celebrity' ? [{ id: 'quick-bio', label: 'Quick Bio exists', weight: 5, passed: hasBioContent, detail: hasBioContent ? 'yes' : 'missing' }] : []),
    { id: 'duplicates', label: 'No duplicate paragraphs', weight: 4, passed: dupes === 0, detail: `${dupes} duplicate(s)` },
    { id: 'stuffing', label: 'No keyword stuffing', weight: 4, passed: stuffed === 0 && density <= 3, detail: stuffed ? `${stuffed} paragraph(s) repeat the keyword` : 'ok' },
    { id: 'empty-headings', label: 'No empty headings', weight: 3, passed: emptyHeadings === 0, detail: `${emptyHeadings}` },
    { id: 'html', label: 'Valid HTML', weight: 3, passed: problems.length === 0, detail: problems.join('; ') || 'ok' },
    { id: 'category', label: 'Category set', weight: 3, passed: !!input.category, detail: input.category ?? 'none' },
    { id: 'tags', label: 'Tags set', weight: 3, passed: input.tags.length > 0, detail: `${input.tags.length} tag(s)` },
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
  return {
    score: Math.round((got / total) * 100),
    checks,
    metrics: { wordCount: words, keywordCount: kwCount, keywordDensity: density, h2Count: h2, h3Count: h3, paragraphs: paragraphs.length, longestParagraph: longest },
  };
}
