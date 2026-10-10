import { nonEmptyLines, plainLine, stripQuotes } from './common';

const RECOMMENDED = /^(?:\*\*)?\s*(?:recommended|best|final|top|empfohlener|bester)\s+(?:title|titel|pick|recommendation)\s*(?:\*\*)?\s*[:：-]\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?$/i;

/** Reads title ideas and the "Recommended Title: …" line from the Title prompt's answer. */
export function parseTitles(text: string): { options: string[]; recommended: string | null } {
  const lines = nonEmptyLines(text);
  let recommended: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = RECOMMENDED.exec(plainLine(lines[i]!)) ?? RECOMMENDED.exec(lines[i]!);
    if (m) {
      let value = stripQuotes(plainLine(m[1]!));
      // "Recommended Title:" alone on a line, title on the next one
      if (!value && lines[i + 1]) value = stripQuotes(plainLine(lines[i + 1]!));
      if (value) recommended = value;
    } else if (/^(?:\*\*)?\s*recommended title\s*:?\s*(?:\*\*)?$/i.test(lines[i]!) && lines[i + 1]) {
      recommended = stripQuotes(plainLine(lines[i + 1]!));
    }
  }
  const options: string[] = [];
  for (const raw of lines) {
    if (!/^\s*(?:[-*•]|\d{1,2}[.)])\s+/.test(raw)) continue;
    let t = stripQuotes(plainLine(raw));
    // "Title – why it works" explanations
    t = t.replace(/\s+[–—-]\s+(why|this|it|great|strong|perfect|ideal|good)\b.*$/i, '').trim();
    t = stripQuotes(t.replace(/\s*\((?:\d+\s*characters?|seo|recommended)[^)]*\)\s*$/i, ''));
    if (t.length < 8 || t.length > 160 || /[:：]$/.test(t)) continue;
    if (!options.includes(t)) options.push(t);
  }
  if (recommended && !options.includes(recommended)) options.unshift(recommended);
  return { options: options.slice(0, 20), recommended: recommended ?? options[0] ?? null };
}
