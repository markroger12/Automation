import { describe, expect, it } from 'vitest';
import { replaceInternalLinkLine } from '@/worker/wordpress/draft';
import { focusKeywordMatches, parseScore, planFixes } from '@/worker/wordpress/rankmath';
import { revisionProblem } from '@/worker/pipelines/stages/wordpress';

describe('WordPress helpers', () => {
  const line = '<p><strong>Also read: <a href="https://s/new/">New Article</a></strong></p>';

  it('replaces only the internal link line of live content (blocks and classic)', () => {
    const blocks = '<!-- wp:paragraph -->\n<p>Hand edited.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p><strong>Also read: <a href="https://s/old/">Old</a></strong></p>\n<!-- /wp:paragraph -->';
    const out = replaceInternalLinkLine(blocks, line, 'Also read:');
    expect(out).toContain('Hand edited.');
    expect(out).toContain('New Article');
    expect(out).not.toContain('Old</a>');
    const classic = '<p>Text</p>\n<p><strong>Also read: <a href="https://s/old/">Old</a></strong></p>';
    expect(replaceInternalLinkLine(classic, line, 'Also read:')).toBe('<p>Text</p>\n' + line);
    expect(replaceInternalLinkLine('<p>Text</p>', line, 'Also read:')).toBe(`<p>Text</p>\n\n${line}`);
  });

  it('accepts the focus keyword plus its score but no other words', () => {
    expect(focusKeywordMatches('andre rock 79', 'Andre Rock')).toBe(true);
    expect(focusKeywordMatches('andre rock', 'andre rock')).toBe(true);
    expect(focusKeywordMatches('andre rock net worth 79', 'andre rock')).toBe(false);
  });

  it('parses Rank Math scores', () => {
    expect(parseScore('79 / 100')).toBe(79);
    expect(parseScore('  8/100')).toBe(8);
    expect(parseScore('N/A')).toBeNull();
  });

  it('plans safe fixes from failed tests (English and German)', () => {
    const plan = planFixes([
      { text: 'Focus Keyword not found in your SEO title.', status: 'fail' },
      { text: 'Fokus-Keyword nicht in der Meta-Beschreibung gefunden.', status: 'fail' },
      { text: 'Focus Keyword not found in the URL.', status: 'fail' },
      { text: 'Use Focus Keyword in the subheading(s) like H2, H3, H4, etc..', status: 'fail' },
      { text: 'Add an image with your Focus Keyword as alt text.', status: 'fail' },
      { text: 'Your title contains a power word.', status: 'ok' },
    ]);
    expect(plan).toMatchObject({ seoTitle: true, meta: true, slug: true, content: true });
    expect(plan.unfixable).toEqual(['Add an image with your Focus Keyword as alt text.']);
  });

  it('rejects content revisions that change too much', () => {
    const p = '<p>' + 'word '.repeat(100) + 'keyword here.</p>';
    const before = `<h2>A</h2>${p}<h2>B</h2>${p}`;
    expect(revisionProblem(before, before, 'keyword')).toBeNull();
    expect(revisionProblem(before, `<h2>A</h2>${p}${p}<h2>B</h2>${p}`, 'keyword')).toMatch(/adds/);
    expect(revisionProblem(before, `<h2>A</h2><p>short</p>`, 'keyword')).toMatch(/cuts/);
    expect(revisionProblem(before, `<h2>A</h2>${p}${p}`, 'keyword')).toMatch(/H2/);
  });
});
