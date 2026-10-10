import { describe, expect, it } from 'vitest';
import { analyzeParagraph, articleNotes, checkLocks, decodeParagraph, encodeParagraph, multiWordNames, parseLabeledAnswer, splitIntoParts, cleanAnswerParagraph, type HumanParagraph } from '@/core/humanizer';

describe('humanizer', () => {
  it('encodes links, bold and italic as marks and decodes them back', () => {
    const html = '<p>She starred in <a href="https://www.imdb.com/title/tt1/" target="_blank" rel="noopener">Euphoria</a> and <strong>won</strong> an <em>award</em>.</p>';
    const e = encodeParagraph(html);
    expect(e.text).toBe('She starred in {L1}Euphoria{/L1} and {b}won{/b} an {i}award{/i}.');
    expect(decodeParagraph('Later {L1}Euphoria{/L1} made her {b}famous{/b}.', e.links)).toBe('<p>Later <a href="https://www.imdb.com/title/tt1/" target="_blank" rel="noopener">Euphoria</a> made her <strong>famous</strong>.</p>');
  });

  it('removes backslash escapes from answers', () => {
    expect(cleanAnswerParagraph('She earned \\$5 million \\(estimated\\) and **won** big.')).toBe('She earned $5 million (estimated) and {b}won{/b} big.');
  });

  it('finds AI filler, inflated words and stock openers', () => {
    const a = analyzeParagraph('It is important to note that her pivotal role was crucial. Furthermore, she delved into acting. Moreover, she grew.', 'English');
    expect(a.problems.join(' ')).toMatch(/filler/);
    expect(a.problems.join(' ')).toMatch(/inflated words: pivotal, crucial/);
    expect(a.problems.join(' ')).toMatch(/Furthermore|furthermore/i);
    expect(a.signals).toBeGreaterThanOrEqual(5);
  });

  it('notes repeated openers and too even sentence lengths', () => {
    const t = ['She acts in films every day now. She sings in bands every week too. She writes many songs for her fans. She travels around the world a lot.', 'She owns a big house in Spokane now. She loves her dogs and her many cats. She reads books about the past a lot. She paints walls in very bright colors.'];
    const notes = articleNotes(t, 'English');
    expect(notes.join(' ')).toMatch(/"she"/);
    expect(notes.join(' ')).toMatch(/too even/);
  });

  it('parses [Pn] answers', () => {
    const m = parseLabeledAnswer('[P1]\nFirst paragraph\ncontinues.\n\n**[P2]**\nSecond.\nP3: Third.');
    expect(m.get(1)).toBe('First paragraph continues.');
    expect(m.get(2)).toBe('Second.');
    expect(m.get(3)).toBe('Third.');
  });

  it('splits into parts of about 1,200 words', () => {
    const p = (n: number, words: number): HumanParagraph => ({ n, blockIndex: n, html: '', encoded: { text: '', links: [] }, analysis: { problems: [], signals: 0, words } });
    expect(splitIntoParts([p(1, 500), p(2, 500), p(3, 500), p(4, 100)]).map((x) => x.map((y) => y.n))).toEqual([[1, 2], [3, 4]]);
  });

  it('finds multi-word names but not sentence openers', () => {
    expect(multiWordNames('Unlike Sydney Sweeney, Jacob Elordi joined HBO. The White Lotus was big.')).toEqual(['Sydney Sweeney', 'Jacob Elordi', 'White Lotus']);
  });

  it('keeps facts locked', () => {
    const o = 'In 2019 Sydney Sweeney joined {L1}Euphoria{/L1} and said "I love this role" to the press about her 3 seasons.';
    expect(checkLocks(o, 'Sydney Sweeney joined {L1}Euphoria{/L1} in 2019 and told the press "I love this role" about her 3 seasons.', 'Sydney Sweeney', 'English').ok).toBe(true);
    expect(checkLocks(o, 'Sweeney Sydney joined {L1}Euphoria{/L1} in 2019 and said "I love this role" to reporters about her 3 seasons.', 'Sweeney', 'English').ok).toBe(true);
    expect(checkLocks(o, 'In 2020 Sydney Sweeney joined {L1}Euphoria{/L1} and said "I love this role" to the press about her 3 seasons.', 'Sydney Sweeney', 'English').reason).toMatch(/numbers/);
    expect(checkLocks(o, 'In 2019 Sydney Sweeney joined Euphoria and said "I love this role" to the press about her 3 seasons.', 'Sydney Sweeney', 'English').reason).toMatch(/links/);
    expect(checkLocks(o, 'In 2019 Sydney Sweeney joined {L1}Euphoria{/L1} and said she loved the role, speaking about her 3 seasons.', 'Sydney Sweeney', 'English').reason).toMatch(/quote/);
    expect(checkLocks(o, 'In 2019 she joined {L1}Euphoria{/L1} and said "I love this role" to the press about her 3 seasons.', 'Sydney Sweeney', 'English').reason).toMatch(/name lost/);
    expect(checkLocks(o, 'In 2019 Sydney Sweeney joined {L1}Euphoria{/L1} and said "I love this role" about 3 seasons.', 'Sydney Sweeney', 'English').ok).toBe(true);
    expect(checkLocks(o, 'Sydney Sweeney, 2019, {L1}Euphoria{/L1}, "I love this role", 3.', 'Sydney Sweeney', 'English').reason).toMatch(/length/);
  });

  it('relaxes the name lock for German', () => {
    const o = 'Die Sängerin Helene Fischer gewann den Echo Musikpreis im Jahr 2014 vor großem Publikum in der Arena.';
    const r = checkLocks(o, 'Helene Fischer gewann im Jahr 2014 den wichtigen Musikpreis vor großem Publikum in der vollen Arena.', 'Helene Fischer', 'German');
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/reworded/);
    expect(checkLocks(o, 'Die Sängerin gewann den Echo Musikpreis im Jahr 2014 vor großem Publikum in der vollen Arena.', 'Helene Fischer', 'German').ok).toBe(false);
  });
});
