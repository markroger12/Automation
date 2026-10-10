import { describe, expect, it } from 'vitest';
import { parseWriter2 } from '@/core/parsers/writer2';

const ANSWER = `I researched Sydney Sweeney using reliable sources. Here is the article.

**1. H1 / Article Title:**
Sydney Sweeney: Age, Career, Net Worth and Life Story

**2. Introduction:**
Sydney Sweeney is an American actress. She became famous with Euphoria.

Second intro paragraph.

**3. Quick Bio table:**
| Attribute | Details |
|---|---|
| Full Name | Sydney Bernice Sweeney |
| Age | 29 |

**4. Main article:**
## Early Life
She grew up in Spokane.

## Career
Her career began in 2009.

**5. Five FAQs:**
### How old is Sydney Sweeney?
She is 29.
### Is she married?
No.

**6. Final Thoughts:**
Sydney Sweeney keeps growing as an actress.

**7. Meta Description:** Sydney Sweeney's age, career and net worth explained in one place.

8. Suggested URL Slug:
sydney-sweeney-age-career-net-worth

9. Tags: Sydney Sweeney, Euphoria, American actress, The White Lotus

10. Internal-link anchors:
- Euphoria cast
- Hollywood actresses

## Research Notes
Sources: Wikipedia, IMDb. Height not confirmed.`;

describe('Celebrity Writer 2.0 parser', () => {
  it('reads every labelled part', () => {
    const r = parseWriter2(ANSWER);
    expect(r.title).toBe('Sydney Sweeney: Age, Career, Net Worth and Life Story');
    expect(r.body.startsWith('Sydney Sweeney is an American actress.')).toBe(true);
    expect(r.body).not.toContain('I researched');
    expect(r.body).not.toMatch(/Main article|Introduction:/);
    expect(r.body).toContain('## Early Life');
    expect(r.body.trim().endsWith('## Final Thoughts\n\nSydney Sweeney keeps growing as an actress.')).toBe(true);
    expect(r.body).not.toContain('Research Notes');
    expect(r.body).not.toContain('Height not confirmed');
    expect(r.quickBio).toEqual([
      { label: 'Full Name', value: 'Sydney Bernice Sweeney' },
      { label: 'Age', value: '29' },
    ]);
    expect(r.faqs.map((f) => f.question)).toEqual(['How old is Sydney Sweeney?', 'Is she married?']);
    expect(r.metaDescription).toBe("Sydney Sweeney's age, career and net worth explained in one place.");
    expect(r.slug).toBe('sydney-sweeney-age-career-net-worth');
    expect(r.tags).toEqual(['Sydney Sweeney', 'Euphoria', 'American actress', 'The White Lotus']);
    expect(r.anchors).toEqual(['Euphoria cast', 'Hollywood actresses']);
    expect(r.researchNotes).toContain('Height not confirmed');
  });

  it('accepts heading labels with values on the next line', () => {
    const r = parseWriter2('## Article Title\nHelene Fischer: Leben und Karriere\n\n## Introduction\nHelene Fischer ist Sängerin.\n\n## Main Article\n## Karriere\nSie singt.\n\n## Fazit\nEnde.\n\n## Meta Description\nAlles über Helene Fischer.\n\n## Tags\n- Helene Fischer\n- Schlager');
    expect(r.title).toBe('Helene Fischer: Leben und Karriere');
    expect(r.body).toBe('Helene Fischer ist Sängerin.\n\n## Karriere\nSie singt.\n\n## Fazit\n\nEnde.');
    expect(r.tags).toEqual(['Helene Fischer', 'Schlager']);
  });

  it('falls back to the whole answer when there are no labels', () => {
    const r = parseWriter2('# Title Here\n\nIntro.\n\n## Part\nText.');
    expect(r.title).toBe('Title Here');
    expect(r.body).toBe('Intro.\n\n## Part\nText.');
  });
});
