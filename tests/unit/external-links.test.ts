import { describe, expect, it } from 'vitest';
import { checkTrustedUrl, isOrganisationSite, parseLinkSuggestions, placeLinks, siteLabel, titleMatchesPhrase } from '@/core/external-links';

describe('external links', () => {
  it('parses LINK lines', () => {
    const t = 'Here you go:\nLINK: Euphoria | https://www.imdb.com/title/tt8772296/\n- **LINK:** HBO | [https://www.hbo.com](https://www.hbo.com)\nLINK: bad | not a url';
    expect(parseLinkSuggestions(t)).toEqual([
      { phrase: 'Euphoria', url: 'https://www.imdb.com/title/tt8772296/' },
      { phrase: 'HBO', url: 'https://www.hbo.com/' },
    ]);
  });

  it('accepts trusted sites only', () => {
    expect(checkTrustedUrl('https://en.wikipedia.org/wiki/Euphoria_(American_TV_series)', 'Euphoria', 'English')).toEqual({ ok: true, kind: 'wikipedia' });
    expect(checkTrustedUrl('https://de.wikipedia.org/wiki/Spokane', 'Spokane', 'English').ok).toBe(false);
    expect(checkTrustedUrl('https://de.wikipedia.org/wiki/Spokane', 'Spokane', 'German').ok).toBe(true);
    expect(checkTrustedUrl('https://www.imdb.com/name/nm2858875/', 'Sydney Sweeney', 'English')).toEqual({ ok: true, kind: 'imdb' });
    expect(checkTrustedUrl('https://www.instagram.com/sydney_sweeney/', 'Instagram', 'English').ok).toBe(false);
    expect(checkTrustedUrl('https://www.celebritynetworth.com/x', 'X', 'English').ok).toBe(false);
    expect(checkTrustedUrl('https://www.britannica.com/place/Spokane', 'Spokane', 'English')).toEqual({ ok: true, kind: 'reference' });
    expect(checkTrustedUrl('https://www.harvard.edu/', 'Harvard University', 'English')).toEqual({ ok: true, kind: 'university' });
    expect(checkTrustedUrl('https://www.uni-heidelberg.de/', 'Universität Heidelberg', 'German').ok).toBe(true);
    expect(checkTrustedUrl('http://www.hbo.com/', 'HBO', 'English').ok).toBe(false);
    expect(checkTrustedUrl('https://randomblog.net/hbo', 'HBO', 'English').ok).toBe(false);
  });

  it('accepts sites named after the organisation', () => {
    expect(isOrganisationSite('www.chla.org', "Children's Hospital Los Angeles")).toBe(true);
    expect(isOrganisationSite('lmu.edu', 'Loyola Marymount University')).toBe(true);
    expect(isOrganisationSite('www.paramount.com', 'Paramount Pictures')).toBe(true);
    expect(isOrganisationSite('www.hbo.com', 'HBO')).toBe(true);
    expect(isOrganisationSite('www.para.com', 'Paramount Pictures')).toBe(false);
    expect(siteLabel('news.bbc.co.uk')).toBe('bbc');
  });

  it('matches page titles to phrases', () => {
    expect(titleMatchesPhrase('Euphoria (American TV series) - Wikipedia', 'Euphoria')).toBe(true);
    expect(titleMatchesPhrase('The White Lotus | HBO', 'The White Lotus')).toBe(true);
    expect(titleMatchesPhrase('Spokane, Washington', 'Spokane')).toBe(true);
    expect(titleMatchesPhrase('Home | Netflix', 'HBO')).toBe(false);
  });

  it('places links in paragraphs only, once, at most 2 per paragraph, non-Wikipedia first, Wikipedia at most half', () => {
    const html = '<h2>Euphoria and HBO</h2><p>She starred in Euphoria on HBO in Spokane with Jacob Elordi.</p><p>Later Euphoria and Spokane again. Jacob Elordi too.</p><p>Sydney Sweeney is great.</p>';
    const res = placeLinks(
      html,
      [
        { phrase: 'Spokane', url: 'https://en.wikipedia.org/wiki/Spokane,_Washington', kind: 'wikipedia' },
        { phrase: 'Jacob Elordi', url: 'https://en.wikipedia.org/wiki/Jacob_Elordi', kind: 'wikipedia' },
        { phrase: 'Euphoria', url: 'https://www.imdb.com/title/tt8772296/', kind: 'imdb' },
        { phrase: 'HBO', url: 'https://www.hbo.com/', kind: 'official' },
        { phrase: 'Sydney Sweeney', url: 'https://www.imdb.com/name/nm2858875/', kind: 'imdb' },
      ],
      { max: 3, keyword: 'Sydney Sweeney' },
    );
    expect(res.added.map((a) => a.phrase)).toEqual(['Euphoria', 'HBO', 'Spokane']);
    expect(res.refused.find((r) => r.phrase === 'Sydney Sweeney')!.reason).toMatch(/keyword/);
    expect(res.refused.find((r) => r.phrase === 'Jacob Elordi')!.reason).toMatch(/Wikipedia|3 links/);
    expect(res.html).toContain('<h2>Euphoria and HBO</h2>');
    // first paragraph full with 2 links → Spokane goes to the later mention
    expect(res.html).toContain('<p>Later Euphoria and <a href="https://en.wikipedia.org/wiki/Spokane,_Washington" target="_blank" rel="noopener">Spokane</a> again.');
  });
});
