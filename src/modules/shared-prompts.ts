import type { PromptDefinition, PromptVariable } from './types';

/** Prompts shared by every writer. Each module keeps its own editable copy in the Prompt Manager. */

export const V = {
  keyword: { name: 'keyword', description: 'The primary keyword (for celebrity articles: the person)' },
  example_title: { name: 'example_title', description: 'Optional example title from the form' },
  selected_title: { name: 'selected_title', description: 'The approved article title' },
  secondary_keywords: { name: 'secondary_keywords', description: 'Secondary keywords, comma separated' },
  country: { name: 'country', description: 'Target country' },
  language: { name: 'language', description: 'Article language (English or German)' },
  category: { name: 'category', description: 'WordPress category name' },
  categories: { name: 'categories', description: "The website's categories, one per line" },
  research: { name: 'research', description: 'Output of the research stage' },
  article: { name: 'article', description: 'The long article' },
  final_article: { name: 'final_article', description: 'The final article body (Markdown)' },
  max_words: { name: 'max_words', description: 'Maximum words (Settings → Content)' },
  word_range: { name: 'word_range', description: 'Target length, for example "1,100–1,300"' },
  min_keyword_occurrences: { name: 'min_keyword_occurrences', description: 'Minimum keyword uses' },
  max_keyword_occurrences: { name: 'max_keyword_occurrences', description: 'Maximum keyword uses' },
  faq_count: { name: 'faq_count', description: 'Number of FAQs' },
  bio_rows_range: { name: 'bio_rows_range', description: 'Quick Bio rows, for example "11–13"' },
  seo_title: { name: 'seo_title', description: 'SEO title' },
  meta_description: { name: 'meta_description', description: 'Meta description' },
  link_count: { name: 'link_count', description: 'How many link suggestions to ask for' },
  wikipedia_site: { name: 'wikipedia_site', description: 'Wikipedia in the article language, e.g. en.wikipedia.org' },
  photo_count: { name: 'photo_count', description: 'Number of attached photos' },
  rankmath_issues: { name: 'rankmath_issues', description: 'Issues reported by Rank Math, one per line' },
  problems: { name: 'problems', description: 'What the local analyser found, per paragraph and article-wide' },
  paragraphs: { name: 'paragraphs', description: 'The paragraphs to edit, labelled [P1], [P2] …' },
  image_description: { name: 'image_description', description: 'What the planned image shows' },
  image_text: { name: 'image_text', description: 'Short text written on the image (featured image only)' },
} satisfies Record<string, PromptVariable>;

export const EXTERNAL_LINKS_PROMPT = `Suggest external links for the final article about "{{keyword}}" (the article is repeated below).

Choose {{link_count}} words or short phrases that appear exactly like this in the article text (same spelling) and that
readers may want to look up, for example:
- other well-known people mentioned in the article (not "{{keyword}}" itself)
- titles of movies, TV shows, songs, albums or books
- universities, schools, companies, teams, bands or awards
- cities, countries and famous places

Take the phrases from different paragraphs of the article, at most 2 from the same paragraph.

For each phrase give one link to a trusted page about exactly that person or thing. Use different kinds of sites, not only Wikipedia:
- IMDb for movies, TV shows, actors and directors
- the official website of a university, school, company, team, band, charity, organisation or award
- a major trusted site such as Britannica, Variety, Billboard, Rolling Stone, ESPN or the BBC
- Wikipedia ({{wikipedia_site}}) for people and places the others do not cover — at most half of the links

Use web search to make sure every page really exists and is about the right person or thing.
Never link to social media, online shops, gossip sites or net-worth sites.
Do not rewrite the article.

Answer only with one line per link in exactly this format and nothing else:
LINK: <phrase exactly as written in the article> | <full URL>

Article:
{{final_article}}`;

export const PHOTO_CHECK_PROMPT = `I am writing an article about "{{keyword}}". I attached {{photo_count}} photos from an image search, numbered 1 to
{{photo_count}} in the order they are attached.

For every photo, write one line in exactly this format:
<number>: watermark=<yes or no> | collage=<yes or no> | alt=<alt text>

watermark=yes when the photo has a watermark, a website name or web address, a channel or photo agency logo, or large
text written over the picture. Text that belongs to the scene itself (a sign, the backdrop at an event, a shirt print)
does not count.
collage=yes when the picture is not one photo but several photos put together: side by side, split by a line, in frames
or a grid, or a designed thumbnail with shapes, borders or boxes around photos.
alt: at most 12 words describing what is visible: the place, the occasion, what the people wear or do. Do not name
anyone and do not guess who the people are; the name is added separately.

Write nothing else.`;

export const SEO_CORRECTION_PROMPT = `The Rank Math SEO plugin reported these issues for the article about "{{keyword}}":

{{rankmath_issues}}

Revise the final article below so that the issues that can be fixed naturally inside the content are resolved — for
example using the focus keyword "{{keyword}}" early in the introduction, or in one relevant subheading.

Rules:
Keep the article at or under {{max_words}} words.
Keep every fact the same and do not invent new information.
Keep Markdown ## H2 and ### H3 headings.
Write in paragraphs only, with no bullet points or numbered lists.
Do not keyword stuff and do not damage readability just to raise a score.

Output only the revised article with no comments.

Article:
{{final_article}}`;

export const IMAGE_SEARCH_PROMPT = `Search the web for real photos of {{keyword}} and show them as an image gallery.

Show at least 10 different, recent, high-quality photos in which the face of {{keyword}} is clearly visible, for example
portraits, red carpet and event photos.
No drawings, no AI-made pictures, no memes, no collages and no screenshots of articles.
Do not write an article; one short caption line is enough.`;

export const HUMANIZER_PROMPT = `You are a senior magazine editor. Edit the numbered paragraphs below so they read like a careful human writer wrote
them: natural, clear and specific. This is an editorial rewrite, not an attempt to fool AI-detection software.

Rules:
1. Keep every fact. Do not add facts, examples, statistics, quotes, sources or personal experience that are not already in the paragraph.
2. Keep every name, date, number and quotation exactly as written.
3. Links are marked like {L1}anchor text{/L1}. Keep every mark with exactly the same words inside it. Keep {b}…{/b} (bold) and {i}…{/i} (italic) marks around the same words.
4. Keep "{{keyword}}" exactly as often as it appears in each paragraph.
5. Remove filler that adds nothing, such as "It is important to note", "It is worth noting", "This highlights" or "In conclusion".
6. Do not start sentences with Additionally, Furthermore, Moreover, Notably, Overall or Ultimately. Connect sentences by meaning instead.
7. Replace inflated words (delve, pivotal, intricate, meticulous, underscore, showcase, testament, tapestry, realm, vibrant, embark, navigate, leverage, foster, crucial, remarkable, renowned, boasts) with plain words when the meaning stays the same.
8. Vary sentence length naturally: a short sentence now and then, a longer one where it helps. Do not add slang, typos or fragments on purpose.
9. Use few dashes; prefer commas or full stops.
10. Keep each paragraph about the same length (within 20%), in the same language and spelling, and as one paragraph.
11. Keep real uncertainty ("may", "reportedly", "estimated"). Do not turn a guess into a fact.

What to fix:
{{problems}}

Answer in the chat as plain text, not in a canvas or document. Give only the edited paragraphs. Put each one under the
same label it has below, with the label alone on its own line, for example a line "[P4]" and the edited paragraph on
the next line. No other text.

Paragraphs:
{{paragraphs}}`;

export function externalLinksPrompt(): PromptDefinition {
  return {
    key: 'external_links',
    name: 'External Links Prompt',
    description: 'Asks for LINK: phrase | URL suggestions. Every suggestion is verified by the app before it is added.',
    defaultContent: EXTERNAL_LINKS_PROMPT,
    variables: [V.keyword, V.link_count, V.wikipedia_site, V.final_article],
  };
}

export function photoCheckPrompt(): PromptDefinition {
  return {
    key: 'photo_check',
    name: 'Photo Check Prompt',
    description: 'Sent with up to 8 chosen photos attached. Finds watermarks and collages and writes alt texts.',
    defaultContent: PHOTO_CHECK_PROMPT,
    variables: [V.keyword, V.photo_count],
  };
}

export function seoCorrectionPrompt(): PromptDefinition {
  return {
    key: 'seo_correction',
    name: 'SEO Correction Prompt',
    description: 'Optional content revision when the Rank Math score is below the target.',
    defaultContent: SEO_CORRECTION_PROMPT,
    variables: [V.keyword, V.rankmath_issues, V.max_words, V.final_article],
  };
}

export function imageSearchPrompt(): PromptDefinition {
  return {
    key: 'image_search',
    name: 'Image Search Prompt',
    description: 'Asks ChatGPT for an image-search gallery of the person. The extension saves the displayed pictures.',
    defaultContent: IMAGE_SEARCH_PROMPT,
    variables: [V.keyword, V.selected_title],
  };
}

export function humanizerPrompt(): PromptDefinition {
  return {
    key: 'humanizer',
    name: 'Humanizer Prompt',
    description: 'Editorial rewrite of the article paragraphs with fact locks (sent in parts of about 1,200 words).',
    defaultContent: HUMANIZER_PROMPT,
    variables: [V.keyword, V.problems, V.paragraphs],
  };
}
