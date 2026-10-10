import * as cheerio from 'cheerio';
import { nonEmptyLines, plainLine } from './common';
import { L } from '../language';

export type BioRow = { label: string; value: string };

const HEADER = /^(attribute|field|detail|details|category|merkmal|eigenschaft|angabe|info(rmation)?)$/i;

function clean(s: string): string {
  return plainLine(s).replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim();
}

function addRow(rows: BioRow[], label: string, value: string) {
  const l = clean(label).replace(/[:：]$/, '');
  const v = clean(value);
  if (!l || !v || l.length > 60) return;
  if (HEADER.test(l) && HEADER.test(v)) return;
  if (/^-{2,}$/.test(l) || /^:?-{2,}:?$/.test(v)) return;
  if (rows.some((r) => r.label.toLowerCase() === l.toLowerCase())) return;
  rows.push({ label: l, value: v });
}

/** Two-column Quick Bio table from Markdown, HTML or "Label: value" lines. */
export function parseQuickBio(input: string, limit = 30): BioRow[] {
  const rows: BioRow[] = [];
  if (/<table/i.test(input)) {
    const $ = cheerio.load(input);
    $('tr').each((_, tr) => {
      const cells = $(tr).children('td,th');
      if (cells.length >= 2) addRow(rows, $(cells[0]).text(), $(cells[1]).text());
    });
    if (rows.length) return rows.slice(0, limit);
  }
  const lines = nonEmptyLines(input);
  const tableLines = lines.filter((l) => /^\|.*\|\s*$/.test(l) || (l.split('|').length >= 3 && !/^#/.test(l)));
  if (tableLines.length >= 2) {
    for (const l of tableLines) {
      const cells = l
        .replace(/^\|/, '')
        .replace(/\|\s*$/, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.trim());
      if (cells.length < 2 || cells.every((c) => /^:?-{2,}:?$/.test(c) || !c)) continue;
      addRow(rows, cells[0]!, cells.slice(1).join(' ').trim());
    }
    if (rows.length) return rows.slice(0, limit);
  }
  for (const l of lines) {
    const m = /^(?:[-*•]\s*)?\**([^:*|]{2,50}?)\**\s*[:：]\s*\**\s*(.+?)\s*$/.exec(l);
    if (m) addRow(rows, m[1]!, m[2]!);
  }
  return rows.slice(0, limit);
}

/** The person's name from the Full Name row (falls back to the keyword). */
export function fullNameFromBio(rows: BioRow[], fallback: string): string {
  const names = [...L.English.fullName, ...L.German.fullName];
  for (const n of names) {
    const row = rows.find((r) => r.label.toLowerCase() === n);
    if (row && row.value && !/not publicly|nicht öffentlich|unknown|unbekannt/i.test(row.value)) {
      return row.value.replace(/\s*\(.*?\)\s*/g, ' ').trim();
    }
  }
  return fallback;
}
