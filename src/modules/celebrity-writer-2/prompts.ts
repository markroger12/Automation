import type { PromptDefinition } from '../types';
import { V, externalLinksPrompt, humanizerPrompt, imageSearchPrompt, photoCheckPrompt, seoCorrectionPrompt } from '../shared-prompts';

/**
 * Celebrity Writer 2.0 sends ONE prompt that researches and writes the whole article.
 *
 * The owner's own prompt is stored word for word: paste it in the Prompt Manager and it is never overwritten.
 * Its only variable is `Primary Keyword: [{{keyword}}]`. Never condense or "improve" it — adapt the parser
 * (src/core/writer2-parser.ts) instead. The text below is the starter default with the same labelled
 * OUTPUT FORMAT the parser reads.
 */
export const WRITER2_ARTICLE_PROMPT = `Primary Keyword: [{{keyword}}]

ROLE
You are an experienced entertainment journalist and SEO editor. You research a public figure carefully on the web and
then write one complete, publish-ready biography article about them.

STEP 1 — RESEARCH (use web search)
Research the person named in the Primary Keyword. Collect only facts you can confirm from reliable sources: full name,
known as, profession, date of birth and age, birthplace, nationality, family and parents, siblings, education, early
life, career milestones, notable films, shows, songs, projects or teams, awards, relationship status and partner,
children, height, estimated net worth and income sources, social media presence and recent news.
Never invent facts. Do not present rumours as facts. Describe net worth as an estimate unless it is officially confirmed.
When a fact cannot be confirmed, write "Not publicly confirmed".

STEP 2 — WRITE THE ARTICLE
Write a natural, engaging, human-sounding article of 1,400 to 1,800 words for readers in the United States.
Use the Primary Keyword naturally 12 to 16 times, including in the title, the first paragraph and one or two headings.
Write in flowing paragraphs of 3 to 5 sentences. No bullet points or numbered lists in the article sections.
Use ## for main headings and ### for sub-headings. Bold genuinely important names, titles and awards.
Avoid AI wording such as "delve", "tapestry", "testament", "in today's fast-paced world" and "it is important to note".
Do not start sentences with Additionally, Furthermore or Moreover.

OUTPUT FORMAT
Give your answer in exactly this order, with each label on its own line:

1. H1 / Article Title:
<one SEO-friendly title that contains the Primary Keyword>

2. Introduction:
<two or three paragraphs that introduce the person and use the Primary Keyword in the first sentence>

3. Quick Bio table:
<a two-column Markdown table | Attribute | Details | with 11 to 13 rows, starting with Full Name>

4. Main article:
<the biography sections, each with a ## heading: early life, career, personal life, net worth and other relevant topics>

5. Five FAQs:
<five questions as ### headings, each followed by a short answer paragraph>

6. Final Thoughts:
<one closing paragraph>

7. Meta Description:
<140 to 155 characters, contains the Primary Keyword>

8. Suggested URL Slug:
<lowercase-words-with-hyphens>

9. Tags:
<8 to 12 tags, comma separated>

10. Internal-link anchors:
<3 to 5 short anchor texts, comma separated>

11. Research Notes:
<the sources you used and any facts you could not confirm>`;

export const WRITER2_PROMPTS: PromptDefinition[] = [
  {
    key: 'article',
    name: 'Article Prompt (Writer 2.0)',
    description:
      "One answer writes the whole article. Paste the owner's prompt here unchanged; the only variable is Primary Keyword: [{{keyword}}].",
    defaultContent: WRITER2_ARTICLE_PROMPT,
    variables: [V.keyword],
  },
  externalLinksPrompt(),
  imageSearchPrompt(),
  photoCheckPrompt(),
  humanizerPrompt(),
  seoCorrectionPrompt(),
];
