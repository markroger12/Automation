import { describe, expect, it } from 'vitest';
import { boilerplateGrams, compareDocs, distinctivePhrases, docFromHtml, docFromText, editSimilarity, makeDoc } from '@/core/plagiarism';

const SOURCE = makeDoc(
  [
    'Sydney Sweeney grew up in Spokane, Washington, where her family ran a small law practice for many years.',
    'Her breakthrough came with the HBO drama Euphoria, in which she played the troubled teenager Cassie Howard.',
    'Critics praised the depth she brought to the role and her willingness to take creative risks on screen.',
    'She was born in 1997.',
  ].join('\n'),
);

describe('plagiarism matching', () => {
  it('finds an exact run of 8+ words with 4+ content words and grows it from the anchor', () => {
    const article = docFromText('Few people know this. Her breakthrough came with the HBO drama Euphoria, in which she played the troubled teenager Cassie Howard. Then she moved on.');
    const r = compareDocs(article, SOURCE);
    expect(r.passages).toHaveLength(1);
    const p = r.passages[0]!;
    expect(p.kind).toBe('exact');
    expect(p.counted).toBe(true);
    expect(p.words).toBe(17);
    expect(p.articleText).toBe('Her breakthrough came with the HBO drama Euphoria, in which she played the troubled teenager Cassie Howard');
    expect(p.sourceBefore).toMatch(/law practice for many years\.\s*$/);
    expect(r.countedWords).toBe(17);
  });

  it('ignores short runs and runs made of common words', () => {
    // 7 shared words, then a different ending.
    const short = docFromText('Her breakthrough came with the HBO drama Succession instead of anything else entirely.');
    expect(compareDocs(short, SOURCE).passages).toHaveLength(0);
    const commonWords = makeDoc('it was one of the things that she had to do in the end');
    const src = makeDoc('and it was one of the things that she had to do in the end anyway');
    expect(compareDocs(commonWords, src).passages).toHaveLength(0);
    // A fact sentence shorter than 8 words never counts.
    expect(compareDocs(docFromText('She was born in 1997.'), SOURCE).passages).toHaveLength(0);
  });

  it('flags a reworded sentence (80%+ of words the same) as a close copy and marks the changed words', () => {
    const article = docFromText('Critics praised the depth she gave to the role and her readiness to take creative risks on screen.');
    const r = compareDocs(article, SOURCE);
    expect(r.passages).toHaveLength(1);
    const p = r.passages[0]!;
    expect(p.kind).toBe('close');
    expect(p.similarity).toBeGreaterThanOrEqual(0.8);
    expect(p.similarity).toBeLessThan(1);
    expect(p.articleDiff!.filter((w) => !w.same).map((w) => w.t)).toEqual(['gave', 'readiness']);
    expect(p.sourceDiff!.filter((w) => !w.same).map((w) => w.t)).toEqual(['brought', 'willingness']);
    // Rewritten more deeply: not a close copy.
    const rewritten = docFromText('Reviewers admired how much depth Sweeney found in the part and how boldly she experimented in front of the camera.');
    expect(compareDocs(rewritten, SOURCE).passages).toHaveLength(0);
  });

  it('shows quoted text without counting it', () => {
    const quoted = docFromText('As one profile put it, “Her breakthrough came with the HBO drama Euphoria, in which she played the troubled teenager Cassie Howard.”');
    const r = compareDocs(quoted, SOURCE);
    expect(r.passages).toHaveLength(1);
    expect(r.passages[0]).toMatchObject({ counted: false, why: 'quoted' });
    expect(r.countedWords).toBe(0);
    expect(r.shownWords).toBe(17);

    const block = docFromHtml('<p>Intro words here.</p><blockquote><p>Critics praised the depth she brought to the role and her willingness to take creative risks on screen.</p></blockquote>');
    expect(compareDocs(block, SOURCE).passages[0]).toMatchObject({ counted: false, why: 'quoted' });
  });

  it("does not count boilerplate: wording found in 10%+ of the owner's own articles", () => {
    const line = 'If you enjoyed this article make sure you share it with your friends and family today.';
    const own = Array.from({ length: 6 }, (_, i) => docFromText(`Article number ${i} talks about topic ${i * 7}. ${i < 2 ? line : 'Nothing else here.'}`));
    const boiler = boilerplateGrams(own);
    expect(boiler.has('make sure you share it')).toBe(true);
    expect(boilerplateGrams(own.slice(0, 4)).size).toBe(0); // too few articles to tell
    const article = docFromText(`New article text. ${line}`);
    const r = compareDocs(article, docFromText(`Another page. ${line}`), boiler);
    expect(r.passages[0]).toMatchObject({ kind: 'exact', counted: false, why: 'boilerplate' });
  });

  it('handles German words with umlauts', () => {
    const src = makeDoc('Die Schauspielerin wuchs in einer kleinen Stadt auf und begann früh mit Theaterkursen für Jugendliche in München.');
    const art = docFromText('Kurz gesagt: Die Schauspielerin wuchs in einer kleinen Stadt auf und begann früh mit Theaterkursen für Jugendliche in München.');
    const r = compareDocs(art, src);
    expect(r.passages).toHaveLength(1);
    expect(r.passages[0]!.articleText).toBe('Die Schauspielerin wuchs in einer kleinen Stadt auf und begann früh mit Theaterkursen für Jugendliche in München');
  });

  it('reads the main text of a web page and skips navigation and footers', () => {
    const doc = docFromHtml(
      '<html><body><nav><a>Home</a><a>About us and our long navigation menu entry</a></nav><article><h1>Title</h1><p>Main text paragraph.</p><ul><li>Point one</li></ul></article><footer><p>Copyright notice</p></footer></body></html>',
      { page: true },
    );
    expect(doc.text).toBe('Title\nMain text paragraph.\nPoint one');
  });

  it('picks distinctive 10-word phrases without numbers, quotes or boilerplate', () => {
    const doc = docFromText(
      [
        'Sweeney trained intensively with stunt coordinators before filming the demanding action sequences for the thriller.',
        'She was born in 1997 and grew up in Spokane with her younger brother Trent.',
        '“This sentence is quoted entirely and should never be searched for by the tool.”',
        'Short one.',
        'Her production company champions unconventional screenplays written by emerging female storytellers from smaller towns.',
      ].join('\n'),
    );
    const phrases = distinctivePhrases(doc, new Set(), 10, 10);
    expect(phrases).toHaveLength(2);
    for (const p of phrases) expect(p.split(' ')).toHaveLength(10);
    expect(phrases.join(' ')).not.toMatch(/1997|quoted/);
    expect(distinctivePhrases(doc, new Set(), 1)).toHaveLength(1);
  });

  it('computes word-level edit similarity', () => {
    expect(editSimilarity(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e'])).toBe(1);
    expect(editSimilarity(['a', 'b', 'c', 'd', 'e'], ['a', 'x', 'c', 'd', 'e'])).toBe(0.8);
    expect(editSimilarity(['a', 'b'], [])).toBe(0);
  });

  it('shows a reworded sentence once, not also the exact pieces inside it', () => {
    const src = makeDoc('The actress moved to Los Angeles with her parents when she was thirteen years old to find work.');
    const art = docFromText('The actress moved to Los Angeles with her parents when she was fourteen years old to look for work.');
    const r = compareDocs(art, src);
    expect(r.passages.map((p) => p.kind)).toEqual(['close']);
    expect(r.passages[0]!.articleDiff!.filter((w) => !w.same).map((w) => w.t)).toEqual(['fourteen', 'look', 'for']);
  });
});
