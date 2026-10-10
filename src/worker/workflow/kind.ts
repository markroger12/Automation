import { prisma } from '@/server/db';
import { nameForLookup, type Kind } from '@/core/keyword-kind';
import { fetchJson } from '../net/safe-fetch';

const HUMAN = 'Q5';
const NOT_PERSON = new Set(['Q11424', 'Q5398426', 'Q1259759', 'Q515', 'Q3957', 'Q486972', 'Q532', 'Q1549591', 'Q7397', 'Q620615', 'Q166142', 'Q7889', 'Q4830453', 'Q783794', 'Q431289', 'Q167270', 'Q2424752', 'Q7725634', 'Q482994', 'Q134556', 'Q6256', 'Q35127', 'Q1002697']);

type Search = { search?: { id: string; label?: string; description?: string }[] };
type Entities = { entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: { id?: string } } } }[]> }> };

/** Wikidata: is the keyword a known human, or a film, a town, software…? */
export async function kindFromWikidata(keyword: string, language: 'en' | 'de' = 'en'): Promise<{ kind: Kind; note: string }> {
  const name = nameForLookup(keyword) || keyword;
  const s = await fetchJson<Search>(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&limit=3&language=${language}&uselang=${language}&search=${encodeURIComponent(name)}`, { timeoutMs: 10_000 });
  const hits = s.search ?? [];
  if (!hits.length) return { kind: 'UNKNOWN', note: 'Wikidata: no match' };
  const ent = await fetchJson<Entities>(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${hits.map((h) => h.id).join('|')}`, { timeoutMs: 10_000 });
  for (const h of hits) {
    const p31 = (ent.entities?.[h.id]?.claims?.P31 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean) as string[];
    if (p31.includes(HUMAN)) return { kind: 'CELEBRITY', note: `Wikidata: ${h.label ?? name} — ${h.description ?? 'human'}` };
    if (p31.some((id) => NOT_PERSON.has(id))) return { kind: 'TIGRAM', note: `Wikidata: ${h.label ?? name} — ${h.description ?? 'not a person'}` };
  }
  return { kind: 'UNKNOWN', note: `Wikidata: ${hits[0]!.label ?? name} — ${hits[0]!.description ?? 'unclear'}` };
}

/** Looks up a few undecided keywords per tick (gentle on Wikidata). Still-undecided ones are picked by hand. */
export async function detectUnknownKinds(limit = 5): Promise<void> {
  const rows = await prisma.workflowKeyword.findMany({ where: { kind: 'UNKNOWN', kindSource: null, state: 'WAITING' }, take: limit, include: { workflow: { include: { website: true } } } });
  for (const kw of rows) {
    try {
      const r = await kindFromWikidata(kw.keyword, kw.workflow.website.language === 'German' ? 'de' : 'en');
      await prisma.workflowKeyword.update({ where: { id: kw.id }, data: { kind: r.kind, kindSource: 'wikidata', kindNote: r.note } });
    } catch (err) {
      await prisma.workflowKeyword.update({ where: { id: kw.id }, data: { kindSource: 'wikidata', kindNote: `Wikidata lookup failed (${err instanceof Error ? err.message : err}); choose the kind by hand.` } });
    }
  }
}
