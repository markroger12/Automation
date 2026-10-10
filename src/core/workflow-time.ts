/** Workflow times: publish times are entered in Pakistan time (Asia/Karachi, UTC+5, no daylight saving). */

export const PKT_OFFSET_MIN = 5 * 60;

export function parseHHMM(t: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

/** "9:30 PM" → "21:30" */
export function from12h(text: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*$/i.exec(text);
  if (!m) return parseHHMM(text) ? text.trim().padStart(5, '0') : null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3]!)) h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export function to12h(hhmm: string): string {
  const p = parseHHMM(hhmm);
  if (!p) return hhmm;
  const ampm = p.h >= 12 ? 'PM' : 'AM';
  return `${p.h % 12 || 12}:${String(p.m).padStart(2, '0')} ${ampm}`;
}

/** Calendar date in Pakistan for an instant. */
export function pktDate(d: Date): { y: number; mo: number; day: number; dow: number } {
  const p = new Date(d.getTime() + PKT_OFFSET_MIN * 60_000);
  return { y: p.getUTCFullYear(), mo: p.getUTCMonth(), day: p.getUTCDate(), dow: p.getUTCDay() };
}

export function pktToUtc(y: number, mo: number, day: number, hhmm: string): Date {
  const p = parseHHMM(hhmm)!;
  return new Date(Date.UTC(y, mo, day, p.h, p.m) - PKT_OFFSET_MIN * 60_000);
}

/** The next slot instants after `from` (one article per time; `days` 0 = Sunday, empty = every day). */
export function nextSlots(publishTimes: string[], days: number[], from: Date, count: number, horizonDays = 366): Date[] {
  const times = [...new Set(publishTimes.filter((t) => parseHHMM(t)))].sort();
  if (!times.length || count <= 0) return [];
  const out: Date[] = [];
  const start = pktDate(from);
  for (let i = 0; i <= horizonDays && out.length < count; i++) {
    const day = new Date(Date.UTC(start.y, start.mo, start.day + i));
    const dow = day.getUTCDay();
    if (days.length && !days.includes(dow)) continue;
    for (const t of times) {
      const slot = pktToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), t);
      if (slot.getTime() > from.getTime()) out.push(slot);
      if (out.length >= count) break;
    }
  }
  return out;
}

/** First free slot after `from` that no other keyword holds. */
export function nextFreeSlot(publishTimes: string[], days: number[], from: Date, taken: Date[]): Date | null {
  const takenSet = new Set(taken.map((d) => d.getTime()));
  for (const s of nextSlots(publishTimes, days, from, 400)) if (!takenSet.has(s.getTime())) return s;
  return null;
}

export function formatPkt(d: Date): string {
  const p = new Date(d.getTime() + PKT_OFFSET_MIN * 60_000);
  const date = p.toISOString().slice(0, 10);
  return `${date} ${to12h(p.toISOString().slice(11, 16))}`;
}

/** Local wall time of an instant in the WordPress time zone ("Europe/Berlin" or "UTC+5:30"), as WordPress expects. */
export function formatInZone(d: Date, tz: string | null | undefined): string {
  const zone = (tz || 'UTC').trim();
  const off = /^UTC\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(zone);
  if (off || /^utc$/i.test(zone)) {
    const sign = off?.[1] === '-' ? -1 : 1;
    const minutes = off ? sign * (Number(off[2]) * 60 + Number(off[3] ?? 0)) : 0;
    return new Date(d.getTime() + minutes * 60_000).toISOString().slice(0, 19);
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
