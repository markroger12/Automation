import { describe, expect, it } from 'vitest';
import { parseTitles } from '@/core/parsers/titles';
import { parseFaqs } from '@/core/parsers/faqs';
import { parseQuickBio, fullNameFromBio } from '@/core/parsers/quick-bio';
import { cleanArticleMarkdown, removeAiCommentary, stripCodeFences, removePreambleBeforeTitle } from '@/core/cleanup';
import { htmlToMarkdown, markdownToHtml, normalizeAnswer } from '@/core/markdown';
import { renderTemplate, templateVariables } from '@/core/template';
import { suggestTags } from '@/core/tags';

describe('titles', () => {
  it('reads options and the recommended title', () => {
    const text = `Here are some title ideas:

1. **Sydney Sweeney: Age, Career and Net Worth in 2026**
2. "Who Is Sydney Sweeney? Her Life and Career"
3. Sydney Sweeney Biography – why it works: it is short

**Recommended Title:** Sydney Sweeney: Age, Career and Net Worth in 2026`;
    const r = parseTitles(text);
    expect(r.recommended).toBe('Sydney Sweeney: Age, Career and Net Worth in 2026');
    expect(r.options).toContain('Who Is Sydney Sweeney? Her Life and Career');
    expect(r.options).toContain('Sydney Sweeney Biography');
    expect(r.options).toHaveLength(3);
  });

  it('handles the recommendation on the next line and German labels', () => {
    expect(parseTitles('1. A first title idea\nRecommended Title:\n"The Second Title Here"').recommended).toBe('The Second Title Here');
    expect(parseTitles('Empfohlener Titel: Helene Fischer: Alter und Vermögen').recommended).toBe('Helene Fischer: Alter und Vermögen');
  });

  it('falls back to the first option', () => {
    expect(parseTitles('1. Only Title Option Here\n2. Another One Here').recommended).toBe('Only Title Option Here');
  });
});

describe('faqs', () => {
  it('reads question/answer lines', () => {
    const text = `How old is Sydney Sweeney?
Sydney Sweeney was born on 12 September 1997.

**What is Sydney Sweeney's net worth?**
Her net worth is estimated at $40 million.

Q3: Is she married?
A: She is engaged.

I hope this helps!`;
    const f = parseFaqs(text);
    expect(f).toHaveLength(3);
    expect(f[1]).toEqual({ question: "What is Sydney Sweeney's net worth?", answer: 'Her net worth is estimated at $40 million.' });
    expect(f[2]!.answer).toBe('She is engaged.');
  });

  it('reads ### heading FAQs with multi-line answers and German', () => {
    const f = parseFaqs('## Häufig gestellte Fragen\n\n### Wie alt ist Helene Fischer?\nSie ist 42 Jahre alt.\nSie wurde 1984 geboren.\n\n### Ist sie verheiratet?\nNein.');
    expect(f).toEqual([
      { question: 'Wie alt ist Helene Fischer?', answer: 'Sie ist 42 Jahre alt. Sie wurde 1984 geboren.' },
      { question: 'Ist sie verheiratet?', answer: 'Nein.' },
    ]);
  });
});

describe('quick bio', () => {
  it('parses a Markdown table and skips the header row', () => {
    const md = `| Attribute | Details |
|---|---|
| **Full Name** | Sydney Bernice Sweeney |
| Age | 29 years |
| Height | Not publicly confirmed |`;
    const rows = parseQuickBio(md);
    expect(rows).toEqual([
      { label: 'Full Name', value: 'Sydney Bernice Sweeney' },
      { label: 'Age', value: '29 years' },
      { label: 'Height', value: 'Not publicly confirmed' },
    ]);
    expect(fullNameFromBio(rows, 'x')).toBe('Sydney Bernice Sweeney');
  });

  it('parses HTML tables and label: value lines', () => {
    expect(parseQuickBio('<table><tr><th>Attribute</th><th>Details</th></tr><tr><td>Born</td><td>1997</td></tr></table>')).toEqual([{ label: 'Born', value: '1997' }]);
    expect(parseQuickBio('- **Profession:** Actress\n- Nationality: American')).toEqual([
      { label: 'Profession', value: 'Actress' },
      { label: 'Nationality', value: 'American' },
    ]);
  });

  it('falls back to the keyword when the name is unknown', () => {
    expect(fullNameFromBio([{ label: 'Full Name', value: 'Not publicly confirmed' }], 'Jane Doe')).toBe('Jane Doe');
  });
});

describe('cleanup', () => {
  it('removes AI commentary, fences, separators, the title heading and duplicate paragraphs', () => {
    const md = "Certainly! Here is your optimized article:\n\n```markdown\n# Sydney Sweeney\n\nIntro paragraph about Sydney Sweeney and her early career in film.\n\n---\n\n## Career\n\nIntro paragraph about Sydney Sweeney and her early career in film.\n\nAnother paragraph.\n```\n\nI hope this helps! Let me know if you want changes.";
    const out = cleanArticleMarkdown(stripCodeFences(md));
    expect(out).toBe('Intro paragraph about Sydney Sweeney and her early career in film.\n\n## Career\n\nAnother paragraph.');
  });

  it('keeps normal first paragraphs', () => {
    expect(removeAiCommentary('Sydney Sweeney is an actress.\n\n## Career')).toBe('Sydney Sweeney is an actress.\n\n## Career');
    expect(removeAiCommentary('Gerne! Hier ist der Artikel:\n\nText.')).toBe('Text.');
  });

  it('drops prose before the title', () => {
    expect(removePreambleBeforeTitle("Sure, I've researched the topic.\n\n# Title\n\nBody")).toBe('# Title\n\nBody');
  });
});

describe('markdown', () => {
  it('converts both ways', () => {
    const html = markdownToHtml('## Career\n\nShe starred in **Euphoria**.\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<h2>Career</h2>');
    expect(html).toContain('<strong>Euphoria</strong>');
    expect(html).toContain('<table>');
    const md = htmlToMarkdown('<h2>Career</h2><p>She starred in <strong>Euphoria</strong> and <a href="https://imdb.com/x">a film</a>.</p><ul><li>One</li><li>Two</li></ul>');
    expect(md).toBe('## Career\n\nShe starred in **Euphoria** and [a film](https://imdb.com/x).\n\n- One\n- Two');
  });

  it('prefers the page HTML when it carries structure', () => {
    expect(normalizeAnswer({ text: 'Career\nShe acts.', html: '<h2>Career</h2><p>She acts.</p>' })).toBe('## Career\n\nShe acts.');
    expect(normalizeAnswer({ text: '## Career\n\nShe acts.', html: '' })).toBe('## Career\n\nShe acts.');
  });
});

describe('template', () => {
  it('renders variables and if/unless blocks', () => {
    const t = 'A {{keyword}}\n{{#if example_title}}Example: "{{example_title}}"\n{{/if}}{{#unless image_text}}No text.{{/unless}}';
    expect(renderTemplate(t, { keyword: 'X', example_title: '' })).toBe('A X\nNo text.');
    expect(renderTemplate(t, { keyword: 'X', example_title: 'T', image_text: 'Hi' })).toBe('A X\nExample: "T"');
    expect(templateVariables(t)).toEqual(['keyword', 'example_title', 'image_text']);
  });

  it('supports nesting', () => {
    expect(renderTemplate('{{#if a}}A{{#if b}}B{{/if}}{{/if}}', { a: 1, b: 0 })).toBe('A');
  });
});

describe('tags', () => {
  it('builds tags from the keyword, secondary keywords and professions', () => {
    expect(suggestTags('sydney sweeney', { secondary: ['Euphoria actress'], quickBio: [{ label: 'Profession', value: 'Actress, producer' }] })).toEqual([
      'Sydney Sweeney',
      'Euphoria actress',
      'Actress',
      'Producer',
    ]);
  });
});
