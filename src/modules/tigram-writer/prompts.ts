import type { PromptDefinition } from '../types';
import { V, externalLinksPrompt, humanizerPrompt, seoCorrectionPrompt } from '../shared-prompts';

export const TIGRAM_ARTICLE_PROMPT = `Write a complete, helpful and SEO-optimized blog article about "{{keyword}}".
{{#if secondary_keywords}}Use these secondary keywords where they fit naturally: {{secondary_keywords}}
{{/if}}{{#if example_title}}Use this as the article title, or a very close version of it: "{{example_title}}"
{{/if}}Length: {{word_range}} words in total.

Start your answer with exactly these three lines:
SEO TITLE: <an SEO title under 60 characters that contains the keyword>
META DESCRIPTION: <a meta description of 100 to 150 characters that contains the keyword>
URL SLUG: <lowercase-words-joined-with-hyphens>

Then write the article in Markdown, in this order:
1. An introduction of 100 to 150 words that opens with a hook. Use the keyword "{{keyword}}" within the first 100 words.
2. A featured-snippet paragraph of 40 to 60 words that answers the main question directly and clearly.
3. 5 to 7 main sections with ## H2 headings (use ### H3 sub-headings where they help). One section is a step-by-step
   guide. One section contains a comparison table or a pros-and-cons table in Markdown.
4. ## Frequently Asked Questions — exactly 7 questions, each as a ### H3 heading followed by a short, direct answer.
5. ## Conclusion — a short summary that ends with a clear call to action.

Rules:
Write for real people first: specific, practical and accurate. Do not invent statistics, prices, versions or features.
Use the keyword naturally; do not keyword stuff.
Do not put the article title as a # H1 heading.
Do not write comments such as "Here is your article" or "I hope this helps".`;

export const TIGRAM_CATEGORY_PROMPT = `Pick the best category for the article about "{{keyword}}" from this list of the website's categories:

{{categories}}

Answer with exactly one line and nothing else:
CATEGORY: <the exact category name from the list>`;

export const TIGRAM_IMAGE_PLAN_PROMPT = `Plan 3 images for the article about "{{keyword}}" (title: "{{selected_title}}").

Image 1 is the featured image: a clean, modern illustration of the topic with a short title text of at most 5 words
written on it.
Images 2 and 3 are flat illustrations for the article body, without any text, letters or logos.

Answer in exactly this format and nothing else:
IMAGE 1: <what the picture shows, in one sentence>
TEXT 1: <the short title text>
ALT 1: <alt text, at most 15 words>
IMAGE 2: <what the picture shows, in one sentence>
ALT 2: <alt text, at most 15 words>
IMAGE 3: <what the picture shows, in one sentence>
ALT 3: <alt text, at most 15 words>`;

export const TIGRAM_IMAGE_PROMPT = `Create one wide 16:9 picture: {{image_description}}
{{#if image_text}}Write this text on the picture in large, clean, correctly spelled letters: "{{image_text}}"
{{/if}}{{#unless image_text}}Do not put any text, letters, numbers or logos on the picture.
{{/unless}}Style: flat, modern illustration with bright colours and simple shapes. No watermark, no border.`;

export const TIGRAM_PROMPTS: PromptDefinition[] = [
  {
    key: 'article',
    name: 'Article Prompt',
    description: 'Starts with SEO TITLE / META DESCRIPTION / URL SLUG lines, then the article in a fixed order.',
    defaultContent: TIGRAM_ARTICLE_PROMPT,
    variables: [V.keyword, V.secondary_keywords, V.example_title, V.word_range],
  },
  {
    key: 'category',
    name: 'Category Prompt',
    description: "Picks one of the website's categories. Answer: CATEGORY: <exact name>.",
    defaultContent: TIGRAM_CATEGORY_PROMPT,
    variables: [V.keyword, V.categories],
  },
  externalLinksPrompt(),
  {
    key: 'image_plan',
    name: 'Image Plan Prompt',
    description: 'Plans the featured image (with a short title text) and 2 body images (no text), with alt texts.',
    defaultContent: TIGRAM_IMAGE_PLAN_PROMPT,
    variables: [V.keyword, V.selected_title],
  },
  {
    key: 'image',
    name: 'Image Prompt',
    description: 'Creates one planned image. Sent once per image.',
    defaultContent: TIGRAM_IMAGE_PROMPT,
    variables: [V.image_description, V.image_text],
  },
  humanizerPrompt(),
  seoCorrectionPrompt(),
];
