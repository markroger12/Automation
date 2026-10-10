/** Language-specific strings. Articles are English or German. */

export type Lang = 'English' | 'German';

export function asLang(language: string | null | undefined): Lang {
  return /^(german|deutsch|de)$/i.test((language ?? '').trim()) ? 'German' : 'English';
}

export const L = {
  English: {
    quickBioHeading: (name: string) => `Quick Bio of ${name}`,
    faqHeading: 'Frequently Asked Questions',
    conclusionHeadings: ['conclusion', 'final thoughts', 'final words', 'wrapping up', 'the bottom line', 'bottom line', 'in conclusion', 'summary', 'closing thoughts'],
    wikipedia: 'en.wikipedia.org',
    notConfirmed: 'Not publicly confirmed',
    attribute: 'Attribute',
    details: 'Details',
    fullName: ['full name', 'name', 'real name', 'birth name'],
    internalLinkText: 'Also read:',
  },
  German: {
    quickBioHeading: (name: string) => `Kurzbiografie von ${name}`,
    faqHeading: 'Häufig gestellte Fragen',
    conclusionHeadings: ['fazit', 'schlussgedanken', 'schlusswort', 'zusammenfassung', 'abschließende gedanken', 'abschliessende gedanken', 'schluss', 'conclusion', 'final thoughts'],
    wikipedia: 'de.wikipedia.org',
    notConfirmed: 'Nicht öffentlich bestätigt',
    attribute: 'Merkmal',
    details: 'Details',
    fullName: ['vollständiger name', 'voller name', 'name', 'bürgerlicher name', 'geburtsname', 'full name'],
    internalLinkText: 'Das könnte Ihnen gefallen:',
  },
} as const;

/** Appended to every text prompt (English too: the account may have many German chats). */
export function languageLine(language: Lang, country: string): string {
  return `Write in ${language} for readers in ${country}.`;
}

export const FAQ_HEADING_RE = /^(frequently asked questions|faqs?|five faqs|\d+\s+faqs|häufig gestellte fragen|häufige fragen|fragen und antworten)\b/i;
export const QUICK_BIO_HEADING_RE = /^(quick bio|quick facts|kurzbiografie|steckbrief|kurzprofil|bio(graphy)? table|quick bio table)\b/i;

export function isConclusionHeading(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[:.!]+$/, '');
  return [...L.English.conclusionHeadings, ...L.German.conclusionHeadings].some((h) => t === h || t.startsWith(h + ':') || t.startsWith(h + ' –') || t.startsWith(h + ' -'));
}
