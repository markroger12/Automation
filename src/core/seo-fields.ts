import { containsKeyword, keywordRegex, sentences, slugify, titleCaseKeyword, truncateAtWord } from './text';
import type { Lang } from './language';

export type SeoFieldInput = {
  title: string;
  keyword: string;
  kind: 'celebrity' | 'tigram';
  language: Lang;
  introText: string;
  given?: { seoTitle?: string | null; metaDescription?: string | null; slug?: string | null };
  year?: number;
};

export type SeoFields = { title: string; seoTitle: string; metaDescription: string; slug: string; focusKeyword: string };

/** An all-lowercase keyword is title-cased in titles and meta ("justin biel" → "Justin Biel"). */
export function capitaliseKeyword(text: string, keyword: string): string {
  const k = keyword.trim();
  if (!k || k !== k.toLowerCase()) return text;
  const cased = titleCaseKeyword(k);
  return text.replace(keywordRegex(k), (m) => (m === m.toLowerCase() ? cased : m));
}

function seoTitleTemplates(K: string, kind: SeoFieldInput['kind'], lang: Lang, year: number): string[] {
  if (kind === 'celebrity') {
    return lang === 'German'
      ? [`${K}: Alter, Karriere, Vermögen & Familie`, `${K}: Alter, Karriere & Vermögen`, `${K}: Biografie & Fakten`, `${K} Biografie`]
      : [`${K}: Age, Career, Net Worth & Family`, `${K}: Age, Career & Net Worth`, `${K}: Biography & Facts`, `${K} Biography`];
  }
  return lang === 'German'
    ? [`${K}: Der komplette Ratgeber (${year})`, `${K}: Ratgeber (${year})`, `${K}: Ratgeber`, K]
    : [`${K}: Complete Guide (${year})`, `${K}: Complete Guide`, `${K} Guide`, K];
}

function metaTemplate(K: string, kind: SeoFieldInput['kind'], lang: Lang): string {
  if (kind === 'celebrity') {
    return lang === 'German'
      ? `Alles über ${K}: Alter, Karriere, Familie und Vermögen. Die vollständige Biografie von ${K} mit aktuellen Fakten.`
      : `Discover ${K}'s age, career, family and net worth. Read the full biography of ${K} with the latest facts.`;
  }
  return lang === 'German'
    ? `Alles Wichtige zu ${K}: Funktionen, Schritt-für-Schritt-Anleitung, Vor- und Nachteile und Antworten auf häufige Fragen.`
    : `Everything you need to know about ${K}: features, a step-by-step guide, pros and cons, and answers to common questions.`;
}

/** SEO title, meta description and slug — built by the app when ChatGPT gave none (English and German templates). */
export function buildSeoFields(input: SeoFieldInput): SeoFields {
  const K = titleCaseKeyword(input.keyword);
  const year = input.year ?? new Date().getFullYear();
  const title = capitaliseKeyword(input.title.trim(), input.keyword);

  let seoTitle = input.given?.seoTitle?.trim() ?? '';
  if (!seoTitle || seoTitle.length > 70 || !containsKeyword(seoTitle, input.keyword)) {
    if (title.length <= 60 && containsKeyword(title, input.keyword)) seoTitle = title;
    else seoTitle = seoTitleTemplates(K, input.kind, input.language, year).find((t) => t.length <= 60) ?? truncateAtWord(K, 60);
  }
  seoTitle = capitaliseKeyword(seoTitle, input.keyword);

  let meta = input.given?.metaDescription?.trim() ?? '';
  if (!meta || meta.length < 80 || meta.length > 170 || !containsKeyword(meta, input.keyword)) {
    let fromIntro = '';
    for (const s of sentences(input.introText)) {
      const next = fromIntro ? `${fromIntro} ${s}` : s;
      if (next.length > 158) break;
      fromIntro = next;
    }
    meta = fromIntro.length >= 110 && containsKeyword(fromIntro, input.keyword) ? fromIntro : metaTemplate(K, input.kind, input.language);
  }
  meta = truncateAtWord(capitaliseKeyword(meta, input.keyword), 158);

  const slug = slugify(input.given?.slug?.trim() || input.keyword) || slugify(title);
  return { title, seoTitle, metaDescription: meta, slug, focusKeyword: input.keyword.trim() };
}
