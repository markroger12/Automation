import type { PromptDefinition } from '../types';
import { V, externalLinksPrompt, humanizerPrompt, imageSearchPrompt, photoCheckPrompt, seoCorrectionPrompt } from '../shared-prompts';

export const TITLE_PROMPT = `Generate some best titles for my blog post.

Target keyword:
"{{keyword}}"

{{#if example_title}}Here's an example article title for an overview:
"{{example_title}}"
{{/if}}

Title Requirements:
Don't use spammy or obvious AI wording terms.
The title should look naturally written by a human.
Keep the title useful, readable and SEO-friendly.
Use the target keyword naturally where appropriate.
Generate several strong title ideas.
At the end, clearly recommend the strongest title to use.

Write the titles in {{language}}.
Put your final recommendation on its own line in exactly this format:
Recommended Title: <the title>`;

export const RESEARCH_PROMPT = `Collect all available reliable information about the keyword:
"{{keyword}}"

The article title is:
"{{selected_title}}"

Make sure the research provides deep details about the person where information is publicly available, including:
Age, Date of Birth, Birthplace, Nationality, Family, Parents, Mother, Father, Siblings, Relationship Status, Boyfriend,
Girlfriend, Partner, Wife, Husband, Children, Education, Early Life, Career, Movies, TV Shows, Projects, Awards,
Achievements, Lifestyle, Height, Physical Appearance, Net Worth, Income Sources, Social Media Presence, Recent Updates,
Interesting Facts and other useful information related to the person.

The information should be detailed enough to create a complete celebrity biography article.
Do not invent personal information.
Do not present rumors as confirmed facts.
Clearly describe net worth figures as estimates when they are not officially verified.`;

export const LONG_ARTICLE_PROMPT = `Now using all the information collected above, write a 1,500 to 2,000-word, humanized and SEO-optimized blog article.

Use the article title provided earlier: "{{selected_title}}"

Focus on the primary keyword:
"{{keyword}}"
{{#if secondary_keywords}}
Where they fit naturally, also use these secondary keywords: {{secondary_keywords}}
{{/if}}
Write in {{language}} for readers in {{country}}.

Strict Formatting & Writing Rules:
Paragraph Format Only: natural narrative paragraphs; no bullet points; no numbered lists; avoid short, disconnected sentences.
Flow & Structure: medium-length flowing paragraphs of about 3 to 5 sentences.
Tone & Style: accessible, engaging, informative and human-like; avoid robotic AI-style wording.
Headings: proper H2 and H3 headings (Markdown ## for H2 and ### for H3); content beneath headings stays in paragraphs.
Keyword Usage: use the primary keyword approximately {{min_keyword_occurrences}} to {{max_keyword_occurrences}} times when
it reads naturally; do not keyword stuff; use pronouns and name variations naturally; do not bold the keyword for SEO.
Important Information: bold genuinely important names, movies, projects, awards, events and facts where useful.
Do not fabricate information. Avoid unnecessary repetition. Create a useful introduction and conclusion.
Do not add FAQs or the Quick Bio table yet.`;

export const FINAL_ARTICLE_PROMPT = `Now rewrite and optimize the previous article into the final publishable version.

Maximum Word Count:
{{max_words}} words.

Follow good SEO practices while keeping the article natural.
Use proper H2 and H3 headings (Markdown ## for H2 and ### for H3).
Write useful content underneath each heading.
Aim for approximately 40 to 70 words under smaller subheadings where suitable.
Larger sections may contain multiple natural paragraphs.
Do not use bullet points or numbered lists inside the main article.
Remove unnecessary filler. Remove repeated information. Avoid spammy wording. Avoid obvious AI phrases.
Make the article easy to read.
Include the primary keyword "{{keyword}}" naturally in the introduction.
Use the keyword naturally in relevant headings when appropriate.
Use semantic and related terms naturally.
Do not fabricate facts.
Keep a short introduction at the top and finish with a conclusion section.

Output only the final article.
Do not include the article title as a heading.
Do not write comments such as "Here is your article", "Certainly", "I hope this helps" or similar AI commentary.`;

export const FAQ_PROMPT = `Write exactly {{faq_count}} short frequently asked questions for this article about "{{keyword}}".

Provide short, useful and accurate answers.
Questions should reflect realistic searches people may make about the celebrity.
Do not invent facts.

Format each FAQ as the question on its own line (ending with a question mark), followed by its answer on the next line.
Output only the FAQs without any introduction or closing comments.`;

export const QUICK_BIO_PROMPT = `Create a Quick Bio table for this celebrity article about "{{keyword}}".

Use approximately {{bio_rows_range}} relevant rows.

Possible fields include: Full Name, Known As, Profession, Date of Birth, Age, Birthplace, Nationality, Education,
Relationship Status, Height, Net Worth, Famous For, Social Media.

Only use information supported by the research.
Do not invent missing values.
If important information is unavailable, use wording such as: Not publicly confirmed

Return a clean two-column HTML-compatible table.
Column 1: Attribute
Column 2: Details

Output only the table.`;

export const CELEBRITY_PROMPTS: PromptDefinition[] = [
  {
    key: 'title',
    name: 'Title Prompt',
    description: 'Title ideas. The line "Recommended Title: …" is read by the app.',
    defaultContent: TITLE_PROMPT,
    variables: [V.keyword, V.example_title, V.language],
  },
  {
    key: 'research',
    name: 'Research Prompt',
    description: 'Detailed biography research, in the same chat.',
    defaultContent: RESEARCH_PROMPT,
    variables: [V.keyword, V.selected_title],
  },
  {
    key: 'long_article',
    name: 'Long Article Prompt',
    description: 'The 1,500–2,000 word article written from the research.',
    defaultContent: LONG_ARTICLE_PROMPT,
    variables: [V.keyword, V.selected_title, V.secondary_keywords, V.language, V.country, V.min_keyword_occurrences, V.max_keyword_occurrences],
  },
  {
    key: 'final_article',
    name: 'Final Optimization Prompt',
    description: 'Rewrites the long article to the maximum word count.',
    defaultContent: FINAL_ARTICLE_PROMPT,
    variables: [V.keyword, V.max_words],
  },
  {
    key: 'faq',
    name: 'FAQ Prompt',
    description: 'Exactly N FAQs: a question line followed by an answer line.',
    defaultContent: FAQ_PROMPT,
    variables: [V.keyword, V.faq_count],
  },
  {
    key: 'quick_bio',
    name: 'Quick Bio Prompt',
    description: 'Two-column Quick Bio table.',
    defaultContent: QUICK_BIO_PROMPT,
    variables: [V.keyword, V.bio_rows_range],
  },
  externalLinksPrompt(),
  imageSearchPrompt(),
  photoCheckPrompt(),
  humanizerPrompt(),
  seoCorrectionPrompt(),
];
