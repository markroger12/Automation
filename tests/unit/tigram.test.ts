import { describe, expect, it } from 'vitest';
import { faqsFromArticle, parseCategoryAnswer, parseImagePlan, parseTigramHeader } from '@/core/parsers/tigram';

describe('Tigram parsers', () => {
  it('reads and removes the three header lines', () => {
    const md = `**SEO TITLE:** Best VPN for Gaming in 2026
META DESCRIPTION: Looking for a fast VPN for gaming? We compare ping, speed and price.
URL SLUG: best-vpn-for-gaming

# Best VPN for Gaming

Gamers need low ping.

## Frequently Asked Questions

### Is a VPN legal?
Yes, in most countries.

### Does a VPN lower ping?
Sometimes.

## Conclusion

Pick one.`;
    const h = parseTigramHeader(md);
    expect(h.seoTitle).toBe('Best VPN for Gaming in 2026');
    expect(h.metaDescription).toContain('VPN for gaming');
    expect(h.slug).toBe('best-vpn-for-gaming');
    expect(h.h1).toBe('Best VPN for Gaming');
    expect(h.body.startsWith('Gamers need low ping.')).toBe(true);
    expect(faqsFromArticle(h.body)).toEqual([
      { question: 'Is a VPN legal?', answer: 'Yes, in most countries.' },
      { question: 'Does a VPN lower ping?', answer: 'Sometimes.' },
    ]);
  });

  it('picks the exact category', () => {
    const cats = [{ name: 'Tech & Apps' }, { name: 'Gaming' }, { name: 'Local Guides' }];
    expect(parseCategoryAnswer('CATEGORY: Gaming', cats)).toEqual({ name: 'Gaming' });
    expect(parseCategoryAnswer('**Category:** "Tech &amp; Apps"', cats)).toEqual({ name: 'Tech & Apps' });
    expect(parseCategoryAnswer('CATEGORY: Movies', cats)).toBeNull();
  });

  it('reads the image plan (text only on the featured image)', () => {
    const plan = parseImagePlan('IMAGE 1: A gamer with headphones\nTEXT 1: Best Gaming VPN\nALT 1: Gamer using a VPN\nIMAGE 2: A world map\nTEXT 2: ignored\nALT 2: Map of servers\nIMAGE 3: A shield icon\nALT 3: Security');
    expect(plan).toEqual([
      { description: 'A gamer with headphones', text: 'Best Gaming VPN', alt: 'Gamer using a VPN' },
      { description: 'A world map', text: null, alt: 'Map of servers' },
      { description: 'A shield icon', text: null, alt: 'Security' },
    ]);
  });
});
