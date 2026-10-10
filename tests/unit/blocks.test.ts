import { describe, expect, it } from 'vitest';
import { htmlToBlocks, stripBlockComments, swapImageSources } from '@/core/blocks';

describe('block markup', () => {
  it('converts paragraphs, headings, lists, tables and images', () => {
    const html = '<p>Intro <strong>bold</strong>.</p><h2>Career</h2><h3>Films</h3><ul><li>One</li><li>Two</li></ul><table class="quick-bio-table"><tbody><tr><td>A</td><td>B</td></tr></tbody></table><figure class="wp-block-image"><img src="https://s/x.webp" alt="X" data-id="12" class="wp-image-12"/></figure><blockquote>Q</blockquote>';
    const out = htmlToBlocks(html);
    expect(out).toContain('<!-- wp:paragraph -->\n<p>Intro <strong>bold</strong>.</p>\n<!-- /wp:paragraph -->');
    expect(out).toContain('<!-- wp:heading -->\n<h2 class="wp-block-heading">Career</h2>');
    expect(out).toContain('<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">Films</h3>');
    expect(out).toContain('<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>One</li>');
    expect(out).toContain('<!-- wp:table {"hasFixedLayout":false,"className":"quick-bio-table"} -->\n<figure class="wp-block-table quick-bio-table"><table><tbody>');
    expect(out).toContain('<!-- wp:image {"id":12,"sizeSlug":"large","linkDestination":"none"} -->\n<figure class="wp-block-image size-large"><img src="https://s/x.webp" alt="X" class="wp-image-12"/></figure>');
    expect(out).toContain('<!-- wp:html -->\n<blockquote>Q</blockquote>');
    expect(stripBlockComments(out)).not.toContain('wp:');
  });

  it('swaps local image sources for uploaded media', () => {
    const html = '<figure class="bas-image" data-bas-image="body-1"><img src="/api/media/tasks/a/b.webp" alt="A" data-bas-image="body-1"/></figure>';
    const out = swapImageSources(html, { '/api/media/tasks/a/b.webp': { id: 7, url: 'https://site/wp-content/uploads/b.webp' } });
    expect(out).toContain('src="https://site/wp-content/uploads/b.webp"');
    expect(out).toContain('class="wp-image-7"');
    expect(out).toContain('data-id="7"');
    expect(out).not.toContain('data-bas-image');
  });
});
