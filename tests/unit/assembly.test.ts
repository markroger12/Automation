import { describe, expect, it } from 'vitest';
import { assembleArticle, placeBodyImages } from '@/core/assembly';
import { topBlocks } from '@/core/html';
import { buildSeoFields, capitaliseKeyword } from '@/core/seo-fields';
import { seoCheck } from '@/core/seo-check';
import { countKeyword, slugify, titleCaseKeyword, countWords } from '@/core/text';

const body = `<p>Intro about Sydney Sweeney.</p><p>Second intro paragraph.</p>
<h2>Early Life</h2><p>Early life text.</p>
<h2>Career</h2><p>Career text.</p><p>More career.</p>
<h2>Frequently Asked Questions</h2><h3>Old?</h3><p>Old answer.</p>
<h2>Personal Life</h2><p>Personal text.</p>
<h2>Conclusion</h2><p>Final words.</p>
<p><strong>Also read: <a href="https://x.com/old/">Old link</a></strong></p>`;

const bio = [
  { label: 'Full Name', value: 'Sydney Bernice Sweeney' },
  { label: 'Age', value: '29' },
];
const faqs = [{ question: 'How old is she?', answer: '29.' }];

describe('assembly', () => {
  it('orders intro → Quick Bio → sections → FAQs → conclusion → internal link', () => {
    const html = assembleArticle({
      bodyHtml: body,
      keyword: 'Sydney Sweeney',
      language: 'English',
      kind: 'celebrity',
      quickBio: bio,
      faqs,
      internalLink: { text: 'Also read:', url: 'https://site.com/prev/', title: 'Previous Article' },
    });
    const h2 = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
    expect(h2).toEqual(['Quick Bio of Sydney Bernice Sweeney', 'Early Life', 'Career', 'Personal Life', 'Frequently Asked Questions', 'Conclusion']);
    expect(html.indexOf('Second intro paragraph')).toBeLessThan(html.indexOf('Quick Bio'));
    expect(html).not.toContain('Old answer');
    expect(html).not.toContain('Old link');
    expect(html.trim().endsWith('<p><strong>Also read: <a href="https://site.com/prev/">Previous Article</a></strong></p>')).toBe(true);
    expect(html).toContain('<table class="quick-bio-table">');
  });

  it('writes German headings', () => {
    const html = assembleArticle({ bodyHtml: '<p>Intro.</p><h2>Karriere</h2><p>Text.</p><h2>Fazit</h2><p>Ende.</p>', keyword: 'Helene Fischer', language: 'German', kind: 'celebrity', quickBio: [{ label: 'Vollständiger Name', value: 'Helene Fischer' }], faqs });
    expect(html).toContain('<h2>Kurzbiografie von Helene Fischer</h2>');
    expect(html).toContain('<h2>Häufig gestellte Fragen</h2>');
    expect(html.indexOf('Häufig gestellte Fragen')).toBeLessThan(html.indexOf('Fazit'));
  });

  it('keeps the Tigram article order and its own FAQ section', () => {
    const html = assembleArticle({ bodyHtml: '<p>Intro.</p><h2>Steps</h2><p>A.</p><h2>Frequently Asked Questions</h2><h3>Q?</h3><p>A.</p><h2>Conclusion</h2><p>End.</p>', keyword: 'x', language: 'English', kind: 'tigram', faqs: [{ question: 'Q?', answer: 'A.' }] });
    expect((html.match(/Frequently Asked Questions/g) ?? []).length).toBe(1);
  });
});

describe('image placement', () => {
  const img = (key: string) => ({ key, src: `/api/media/${key}.webp`, alt: key });

  it('puts body image 1 above the 3rd H2 when the 2nd H2 follows the Quick Bio, image 2 one paragraph before the FAQs', () => {
    const html = assembleArticle({ bodyHtml: body, keyword: 'Sydney Sweeney', language: 'English', kind: 'celebrity', quickBio: bio, faqs, bodyImages: [img('b1'), img('b2')] });
    const blocks = topBlocks(html);
    const i1 = blocks.findIndex((b) => b.html.includes('data-bas-image="b1"'));
    const i2 = blocks.findIndex((b) => b.html.includes('data-bas-image="b2"'));
    // H2 order: Quick Bio(1), Early Life(2), Career(3)… → image 1 above "Career"
    expect(blocks[i1 + 1]!.text).toBe('Career');
    // one paragraph before the FAQs: image, paragraph, FAQ heading
    expect(blocks[i2 + 1]!.tag).toBe('p');
    expect(blocks[i2 + 2]!.text).toBe('Frequently Asked Questions');
  });

  it('puts body image 1 above the 2nd H2 without a Quick Bio', () => {
    const blocks = placeBodyImages(topBlocks('<p>a</p><h2>One</h2><p>b</p><h2>Two</h2><p>c</p><h2>Conclusion</h2><p>d</p>'), [img('b1')]);
    const i = blocks.findIndex((b) => b.tag === 'figure');
    expect(blocks[i + 1]!.text).toBe('Two');
  });

  it('never above the FAQs or the conclusion: then after the 2nd paragraph', () => {
    const blocks = placeBodyImages(topBlocks('<p>a</p><p>b</p><h2>One</h2><p>c</p><h2>Conclusion</h2><p>d</p>'), [img('b1')]);
    const i = blocks.findIndex((b) => b.tag === 'figure');
    expect(blocks[i - 1]!.text).toBe('b');
  });
});

describe('text helpers', () => {
  it('counts keywords with Unicode boundaries (umlauts)', () => {
    expect(countKeyword('Jürgen Müller und jürgen müller, aber nicht Jürgen Müllers.', 'Jürgen Müller')).toBe(2);
    expect(countKeyword('Sydney Sweeney, sydney  sweeney!', 'sydney sweeney')).toBe(2);
    expect(countWords("Sydney's career isn't over — 2026.")).toBe(5);
  });

  it('slugifies German text and title-cases lowercase keywords', () => {
    expect(slugify('Jürgen Müller: Größe & Vermögen')).toBe('juergen-mueller-groesse-and-vermoegen');
    expect(titleCaseKeyword('justin biel')).toBe('Justin Biel');
    expect(titleCaseKeyword('iPhone 17 review')).toBe('iPhone 17 review');
    expect(capitaliseKeyword('All about justin biel today', 'justin biel')).toBe('All about Justin Biel today');
  });
});

describe('seo fields', () => {
  it('builds SEO title, meta description and slug when ChatGPT gave none', () => {
    const f = buildSeoFields({ title: 'Who Is justin biel? A Look at His Life, Career, Family and Every Detail You Want', keyword: 'justin biel', kind: 'celebrity', language: 'English', introText: 'Short.' });
    expect(f.title).toContain('Justin Biel');
    expect(f.seoTitle).toBe('Justin Biel: Age, Career, Net Worth & Family');
    expect(f.metaDescription).toContain('Justin Biel');
    expect(f.metaDescription.length).toBeLessThanOrEqual(158);
    expect(f.slug).toBe('justin-biel');
  });

  it('uses German templates and given values', () => {
    const f = buildSeoFields({ title: 'x', keyword: 'Helene Fischer', kind: 'celebrity', language: 'German', introText: '' });
    expect(f.seoTitle).toBe('Helene Fischer: Alter, Karriere, Vermögen & Familie');
    const g = buildSeoFields({ title: 'Best VPN for Gaming', keyword: 'vpn for gaming', kind: 'tigram', language: 'English', introText: '', given: { seoTitle: 'Best VPN for Gaming in 2026', metaDescription: 'Looking for the best VPN for gaming? We compare speed, ping and price so you can pick the right VPN for gaming today.', slug: 'Best VPN for Gaming' } });
    expect(g.seoTitle).toBe('Best VPN For Gaming in 2026'.replace('For', 'for'));
    expect(g.slug).toBe('best-vpn-for-gaming');
  });
});

describe('seo check', () => {
  it('scores a good article high and flags problems', () => {
    const para = (n: number) => `<p>${'Sydney Sweeney is a talented actress with a long career. '.repeat(1)}${'Words fill this paragraph nicely for readers. '.repeat(n)}</p>`;
    const html = `${para(8)}<h2>Sydney Sweeney Early Life</h2>${para(10)}<h3>School</h3>${para(6)}<h2>Career</h2>${para(10)}${para(10)}<h2>Frequently Asked Questions</h2><h3>Q?</h3><p>A.</p><h2>Conclusion</h2>${para(6)}`;
    const report = seoCheck({ keyword: 'Sydney Sweeney', title: 'Sydney Sweeney Biography', seoTitle: 'Sydney Sweeney: Age, Career & Net Worth', metaDescription: 'Discover Sydney Sweeney age, career, family and net worth. Read the full biography of Sydney Sweeney with the latest facts here.', slug: 'sydney-sweeney', contentHtml: html, kind: 'celebrity', maxWords: 600, minKeyword: 5, maxKeyword: 10, hasFaqs: true, hasQuickBio: true, category: 'Celebrities', tags: ['Sydney Sweeney'] });
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.checks.find((c) => c.id === 'kw-intro')!.passed).toBe(true);
    const bad = seoCheck({ keyword: 'Sydney Sweeney', title: 'Biography', seoTitle: '', metaDescription: 'short', slug: 'bio', contentHtml: '<p>Text</p><h2></h2>', kind: 'celebrity', maxWords: 1300, minKeyword: 15, maxKeyword: 18, hasFaqs: false, hasQuickBio: false, category: null, tags: [] });
    expect(bad.score).toBeLessThan(30);
    expect(bad.checks.find((c) => c.id === 'empty-headings')!.passed).toBe(false);
  });
});
