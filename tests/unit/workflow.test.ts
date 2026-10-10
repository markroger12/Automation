import { describe, expect, it } from 'vitest';
import { formatInZone, formatPkt, from12h, nextFreeSlot, nextSlots, to12h } from '@/core/workflow-time';
import { kindFromCsv, kindFromRules, nameForLookup, parseKeywordCsv, parseKeywordRows } from '@/core/keyword-kind';

describe('workflow time slots', () => {
  it('converts Pakistan times to UTC slots in order, skipping past times and other weekdays', () => {
    // 2026-10-10 is a Saturday. 09:00 UTC = 14:00 PKT.
    const from = new Date('2026-10-10T09:00:00Z');
    const slots = nextSlots(['20:00', '09:30', '15:00'], [], from, 4);
    expect(slots.map((d) => d.toISOString())).toEqual(['2026-10-10T10:00:00.000Z', '2026-10-10T15:00:00.000Z', '2026-10-11T04:30:00.000Z', '2026-10-11T10:00:00.000Z']);
    const weekdays = nextSlots(['09:00'], [1, 3], from, 2); // Monday, Wednesday
    expect(weekdays.map((d) => d.toISOString())).toEqual(['2026-10-12T04:00:00.000Z', '2026-10-14T04:00:00.000Z']);
  });

  it('gives each article its own free slot', () => {
    const from = new Date('2026-10-10T09:00:00Z');
    const taken = [new Date('2026-10-10T10:00:00Z')];
    expect(nextFreeSlot(['15:00', '20:00'], [], from, taken)!.toISOString()).toBe('2026-10-10T15:00:00.000Z');
  });

  it('formats in the WordPress time zone and in Pakistan time', () => {
    const d = new Date('2026-10-10T15:00:00Z');
    expect(formatInZone(d, 'Europe/Berlin')).toBe('2026-10-10T17:00:00');
    expect(formatInZone(new Date('2026-12-10T15:00:00Z'), 'Europe/Berlin')).toBe('2026-12-10T16:00:00');
    expect(formatInZone(d, 'UTC+5:30')).toBe('2026-10-10T20:30:00');
    expect(formatInZone(d, 'UTC-4')).toBe('2026-10-10T11:00:00');
    expect(formatInZone(d, null)).toBe('2026-10-10T15:00:00');
    expect(formatPkt(d)).toBe('2026-10-10 8:00 PM');
    expect(from12h('9:30 PM')).toBe('21:30');
    expect(from12h('12:05 am')).toBe('00:05');
    expect(to12h('00:05')).toBe('12:05 AM');
  });
});

describe('keyword kinds and lists', () => {
  it('detects kinds from wording', () => {
    expect(kindFromRules('sydney sweeney net worth').kind).toBe('CELEBRITY');
    expect(kindFromRules('Jacob Elordi wife').kind).toBe('CELEBRITY');
    expect(kindFromRules('Helene Fischer Vermögen').kind).toBe('CELEBRITY');
    expect(kindFromRules('best vpn for gaming').kind).toBe('TIGRAM');
    expect(kindFromRules('pizza near me').kind).toBe('TIGRAM');
    expect(kindFromRules('download capcut for pc').kind).toBe('TIGRAM');
    expect(kindFromRules('WhatsApp 2.24.1').kind).toBe('TIGRAM');
    expect(kindFromRules('Sydney Sweeney').kind).toBe('UNKNOWN');
    expect(nameForLookup("sydney sweeney's net worth")).toBe('sydney sweeney');
    expect(nameForLookup('how tall is jacob elordi height')).toBe('jacob elordi');
  });

  it('parses pipe lines and pasted Google Sheets columns', () => {
    expect(parseKeywordRows('Sydney Sweeney | sydney sweeney age, sydney sweeney height | Who Is Sydney Sweeney?\nkeyword\tsecondary\ttitle\nbest vpn\tvpn for gaming; fast vpn\t\n\n# comment')).toEqual([
      { keyword: 'Sydney Sweeney', secondaryKeywords: ['sydney sweeney age', 'sydney sweeney height'], title: 'Who Is Sydney Sweeney?' },
      { keyword: 'best vpn', secondaryKeywords: ['vpn for gaming', 'fast vpn'], title: null },
    ]);
    expect(kindFromCsv('Celebrity')).toBe('CELEBRITY');
    expect(kindFromCsv('tigram')).toBe('TIGRAM');
    expect(kindFromCsv('')).toBeUndefined();
  });

  it('reads CSV files with or without a header, with commas or semicolons', () => {
    expect(parseKeywordCsv('\uFEFFKeyword,Secondary Keywords,Title,Kind\n"Holland, Tom",tom holland age;tom holland height,"Tom ""Spidey"" Holland",celebrity\nbest vpn,,,\n')).toEqual([
      { keyword: 'Holland, Tom', secondaryKeywords: ['tom holland age', 'tom holland height'], title: 'Tom "Spidey" Holland', kind: 'CELEBRITY' },
      { keyword: 'best vpn', secondaryKeywords: [], title: null, kind: undefined },
    ]);
    expect(parseKeywordCsv('Titel;Keyword;Typ\nWer ist Helene?;Helene Fischer;celebrity')).toEqual([{ keyword: 'Helene Fischer', secondaryKeywords: [], title: 'Wer ist Helene?', kind: 'CELEBRITY' }]);
    expect(parseKeywordCsv('zendaya age,zendaya height,Zendaya Age\nbest vpn')).toEqual([
      { keyword: 'zendaya age', secondaryKeywords: ['zendaya height'], title: 'Zendaya Age', kind: undefined },
      { keyword: 'best vpn', secondaryKeywords: [], title: null, kind: undefined },
    ]);
  });
});
