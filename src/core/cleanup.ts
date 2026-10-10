/**
 * Cleans ChatGPT answers before they become article content: AI commentary, code fences, preamble before
 * the title, duplicate paragraphs, stray separators.
 */

const OPENERS = [
  /^(sure|certainly|of course|absolutely|great|okay|ok|alright)\b[!,.]?/i,
  /^(here('s| is| are)|below is|below you will find|this is)\b.*\b(article|version|draft|rewrite|text|blog|post|faqs?|table|title|summary|optimized|revised|final)\b/i,
  /^i('ve| have)\s+(written|rewritten|created|optimized|revised|prepared|updated|kept|made)\b/i,
  /^(gerne|natürlich|selbstverständlich|klar)\b[!,.]?/i,
  /^hier (ist|sind|kommt|findest du|finden sie)\b/i,
];

const CLOSERS = [
  /^(i hope|hope this|let me know|feel free|if you('d| would) like|would you like|want me to|shall i|do you want|should i|happy to help|i can also|need any)/i,
  /^(ich hoffe|lass mich wissen|lassen sie mich wissen|möchtest du|möchten sie|soll ich|falls du|wenn du möchtest)/i,
  /^(word count|total words|wortanzahl)\s*[:：]/i,
  /^\(?(approximately|about|ca\.?|circa)?\s*\d[\d,.]*\s*(words|wörter)\)?\.?$/i,
];

export function stripCodeFences(text: string): string {
  let t = text.trim();
  const whole = /^```[a-z]*\s*\n([\s\S]*?)\n```\s*$/i.exec(t);
  if (whole) return whole[1]!.trim();
  t = t.replace(/^```(?:markdown|md|html|text)?\s*$/gim, '').replace(/^```\s*$/gm, '');
  return t.trim();
}

function paragraphs(md: string): string[] {
  return md.split(/\n{2,}/);
}

function isOpener(p: string): boolean {
  const t = p.replace(/[*_#>]/g, '').trim();
  return t.length < 300 && OPENERS.some((re) => re.test(t)) && !/\n/.test(t.trim());
}

function isCloser(p: string): boolean {
  const t = p.replace(/[*_#>]/g, '').trim();
  return t.length < 400 && CLOSERS.some((re) => re.test(t));
}

/** Removes "Here is your article", "Certainly!", "I hope this helps" and similar lines at the start and end. */
export function removeAiCommentary(md: string): string {
  const parts = paragraphs(md.trim());
  while (parts.length && (isOpener(parts[0]!) || /^[-*_]{3,}$/.test(parts[0]!.trim()))) parts.shift();
  while (parts.length && (isCloser(parts[parts.length - 1]!) || /^[-*_]{3,}$/.test(parts[parts.length - 1]!.trim()))) parts.pop();
  return parts.join('\n\n').trim();
}

/** Drops a leading "# Title" heading (the final article must not repeat its title). */
export function removeTitleHeading(md: string): string {
  return md.replace(/^\s*#\s+[^\n]+\n+/, '').trim();
}

/** Drops prose before the first heading when the answer starts with commentary (Writer 2.0, rewrites). */
export function removePreambleBeforeTitle(md: string): string {
  const m = /^([\s\S]*?)(^#{1,2}\s)/m.exec(md);
  if (!m || !m[1]!.trim()) return md.trim();
  const pre = m[1]!.trim();
  if (pre.length < 400 && paragraphs(pre).every((p) => isOpener(p) || p.trim().length < 200)) return md.slice(m[1]!.length).trim();
  return md.trim();
}

function norm(p: string): string {
  return p.toLowerCase().replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
}

/** Removes exact duplicate paragraphs (headings may repeat legitimately, so only text paragraphs count). */
export function dedupeParagraphs(md: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paragraphs(md)) {
    const n = norm(p);
    const isHeading = /^\s*#{1,6}\s/.test(p);
    if (!isHeading && n.length > 40) {
      if (seen.has(n)) continue;
      seen.add(n);
    }
    out.push(p);
  }
  return out.join('\n\n');
}

/** Removes standalone horizontal rules ChatGPT uses as separators. */
export function removeSeparators(md: string): string {
  return md.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function cleanArticleMarkdown(md: string, opts: { dropTitle?: boolean } = {}): string {
  let t = stripCodeFences(md);
  t = removeAiCommentary(t);
  t = removeSeparators(t);
  if (opts.dropTitle !== false) t = removeTitleHeading(t);
  t = dedupeParagraphs(t);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
