/** Removes Markdown decoration from a single line: bold/italic marks, heading hashes, list numbering, quotes. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*•–]|\d{1,2}[.)]|\(\d{1,2}\))\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((?:https?:[^)]+)\)/g, '$1')
    .trim();
}

export function stripQuotes(s: string): string {
  return s
    .trim()
    .replace(/^["'“”„‚‘’«»]+|["'“”„‚‘’«»]+$/g, '')
    .trim();
}

export function nonEmptyLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
