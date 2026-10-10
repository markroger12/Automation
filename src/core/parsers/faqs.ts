import { nonEmptyLines, plainLine } from './common';

export type Faq = { question: string; answer: string };

const Q_PREFIX = /^(?:q(?:uestion)?\s*\d*\s*[:.)-]\s*|frage\s*\d*\s*[:.)-]\s*|faq\s*\d*\s*[:.)-]\s*)/i;
const A_PREFIX = /^(?:a(?:nswer)?\s*\d*\s*[:.)-]\s*|antwort\s*[:.)-]\s*)/i;
const CLOSING = /^(i hope|let me know|feel free|if you('d| would) like|would you like|want me to|do you want|ich hoffe|lass mich wissen|möchtest du|sag mir)/i;
const HEADING = /^(frequently asked questions|faqs?|häufig gestellte fragen|fragen und antworten)\b/i;

function isQuestion(raw: string): boolean {
  const t = plainLine(raw).replace(Q_PREFIX, '').trim();
  return t.length >= 6 && t.length <= 220 && /\?\s*$/.test(t);
}

/** Question line (ending with "?") followed by its answer; tolerant to numbering, bold, "Q:/A:" and ### headings. */
export function parseFaqs(text: string, limit = 50): Faq[] {
  const lines = nonEmptyLines(text.replace(/<\/?(p|br|h\d|li|strong|b)[^>]*>/gi, '\n'));
  const out: Faq[] = [];
  let current: Faq | null = null;
  for (const raw of lines) {
    if (/^[-*_]{3,}$/.test(raw) || HEADING.test(plainLine(raw))) continue;
    if (isQuestion(raw)) {
      if (current && current.answer) out.push(current);
      current = { question: plainLine(raw).replace(Q_PREFIX, '').trim(), answer: '' };
      continue;
    }
    if (!current) continue;
    const line = plainLine(raw).replace(A_PREFIX, '').trim();
    if (!line || CLOSING.test(line)) continue;
    current.answer = current.answer ? `${current.answer} ${line}` : line;
  }
  if (current && current.answer) out.push(current);
  return out.slice(0, limit);
}

export function faqsToText(faqs: Faq[]): string {
  return faqs.map((f) => `${f.question}\n${f.answer}`).join('\n\n');
}
