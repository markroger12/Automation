# Blog Automation Studio

A private dashboard that runs on your own Windows PC. It writes SEO articles with **ChatGPT (the website)** and
saves them as **WordPress drafts** with the Rank Math fields filled in. With the Workflow, it can also schedule
finished drafts and ask Google to index them.

- ChatGPT is used only through chatgpt.com, in a separate Chrome window with our own extension. No other AI
  service is used.
- WordPress runs through saved Chrome profiles. You log in yourself once per website. The app never stores or types
  passwords.
- Everything is saved as a **draft** unless you allow a website to publish by itself (see [Safety](#safety)).
- No Docker, no database server. One SQLite file in `data/`.

---

## Quick start (Windows)

You need:

- **Windows 10 or 11**
- **Node.js 20.9 or newer.** Get the LTS version from https://nodejs.org.
- **Google Chrome**
- A **ChatGPT account**
- Your **WordPress** websites, with Rank Math installed

Open PowerShell in the project folder and run:

```powershell
npm install
npm run setup
npm run dev:all
```

Then open **http://localhost:3000** and create the first admin account. This only works while no user exists.

`npm run setup` is safe to run again at any time. It does the following:

- creates `.env` with a random `SESSION_SECRET`;
- creates the `data/` folders;
- updates the database;
- adds the default settings and prompts. A prompt you edited is never overwritten.

`npm run dev:all` starts two processes together:

- `web`: the dashboard on port 3000;
- `worker`: the only process that opens browsers and runs jobs.

Keep both running.

---

## First-time setup

Do these steps once, in this order.

### 1. Automation Chrome and the ChatGPT Worker extension

The worker opens a **separate Chrome** (its own profile in `data/chatgpt-chrome`) whenever ChatGPT prompts are
waiting. It shows the page **http://localhost:3000/automation-chrome**.

1. In that Chrome window, open `chrome://extensions` and switch on **Developer mode** (top right).
2. Press **Load unpacked** and choose the `extension` folder of this project.

   Recent Chrome versions ignore the `--load-extension` flag, so this step is done by hand. It needs to be done
   only once.
3. In the dashboard, go to **Settings → Create connection key**.
4. In the Automation Chrome, click the extension icon. It is under the puzzle piece; pin **ChatGPT Worker**. Paste
   the key and the app address (`http://localhost:3000`), then press **Save and connect**.
5. Log in to **chatgpt.com** in that window.
6. Leave the window open. You can keep it behind other windows, but **do not minimize it**, and keep the PC
   unlocked.

When ChatGPT asks you to log in or shows a human check, you get a desktop notification. The article waits up to 10
minutes for you.

If you would rather use your usual Chrome profile, set **Settings → Browser → Automation Chrome** to **My usual Chrome
profile**. Then install the extension there in the same way.

### 2. Websites

1. Go to **Websites → Add website** and enter the name, address, language (English or German) and target country.
2. Open the website and press **Login**. A Chrome window opens with that website's own saved profile.
3. Log in to WordPress yourself, then close the window.
4. Press **Test Session**, then **Sync Categories**. Choose a default category.
5. Press **Read time zone**. The Workflow needs it to schedule posts at the right moment.

Each website has its own profile in `data/profiles`. **Treat these folders like passwords.**

### 3. Prompts

All prompts are in the **Prompt Manager**. Each one lists the variables it can use, such as `{{keyword}}`.

**Celebrity Writer 2.0** ships with a placeholder prompt. Paste your own prompt into the Prompt Manager before you
use it. Keep the numbered output labels (`1. H1 / Article Title:` … `10. Research Notes:`) so the app can read the
answer.

### 4. Optional tools

```powershell
npm run tools:install
```

This downloads the **face detector** (MediaPipe BlazeFace) into `data/tools/mediapipe`. Image crops then centre on
faces.

**Upscayl** enlarges small or soft pictures. You install it by hand:

1. Download `upscayl-ncnn` from https://github.com/upscayl/upscayl-ncnn/releases.
2. Put `upscayl-bin.exe` in `data/tools/upscayl`.
3. Put the `remacri-4x` model files in `data/tools/upscayl/models`. They come with the Upscayl app, in
   `resources/models`.

`npm run tools:install` shows the exact folders. Missing tools never stop an article; the step is skipped and noted.

### 5. Image Template

Open **Image Template** to pick or customise the featured-image design: picture, logo, boxes and text. The preview is
rendered by the worker.

---

## Daily use

| Page | What it does |
|---|---|
| **Celebrity Article Writer 1.0 / Celebrity Writer 2.0 / Tigram Article Writer** | Add one keyword, or many with **Multiple keywords** (`keyword \| secondary1, secondary2`), or import a CSV. |
| **Article Queue** | Live progress. Cancel, retry and bulk actions. |
| **Article History / article page** | Overview, titles, editor, stages, logs and the ChatGPT conversation. Regenerate a stage, run the SEO check, send to WordPress, open the draft or check for plagiarism. |
| **Workflow** | A keyword list per website, written ahead and saved as drafts at your publish times (Pakistan time). It can also schedule posts and request indexing (see below). |
| **AI Humanizer** | Test the editorial rewrite on any article or pasted text. Facts, links, numbers and names are locked. |
| **Plagiarism Check** | Shows passages your article shares with other pages, side by side. There is no score; you read the evidence. |
| **Settings / Logs** | All options, users and the connection key. Logs can be filtered and include screenshots. |

Every stage is saved as it finishes. A stopped or failed article resumes from its last finished stage. It never
sends a prompt twice and never creates a second post.

### Workflow

1. Open **Workflow**, choose a website and add your publish times, for example `9:00 AM`.
2. Choose the days and when writing should start: right away, or N hours before the publish time.
3. Paste keywords, one per line (`keyword | secondary keywords | title`), or upload a CSV with the columns
   `keyword, secondary keywords, title, kind`.

Each keyword gets a writer:

- A person's name ("… net worth", "… wife") goes to the **celebrity writer**. Choose 1.0 or 2.0 in Settings.
- Anything else goes to the **Tigram writer**.

If the wording is unclear, the app asks Wikidata. If it still can't tell, you choose the writer in the list.

At most 10 articles are written ahead. A failed article is retried up to 3 times and takes the next free slot.

**Scheduling in WordPress happens only when an admin switches on "This website may publish by itself" for that
website.** Without it, the Workflow only saves drafts.

**Ask Google to index it** needs the Search Console property, for example `sc-domain:example.com`. It also needs
the website's browser profile to be logged in to Search Console: press **Open Browser** on the website page and log
in there once. Google allows about 10 requests a day.

### Plagiarism Check

The check compares an article with these sources:

- your other articles;
- the pages it links to (at most 10; links to your own websites are skipped);
- up to 10 pages you add;
- Wikipedia;
- optionally, Google results through **serper.dev**. Put `SERPER_API_KEY` in `.env` and restart the app. Each check
  searches 10 distinctive phrases (10 credits) and reads the top 12 pages.

How passages are judged:

- Exact runs of 8 or more words, with at least 4 content words, are shown.
- So are reworded sentences that keep at least 80% of their words in place.
- Quotations, and wording you repeat in many of your own articles (boilerplate), are shown but not counted.

---

## Safety

- **Drafts only.** Every WordPress browser has a network-level publish guard. It blocks publish, schedule, private
  and pending.
- The **only** exception is the Workflow scheduling a draft for a website where an admin switched on **This website
  may publish by itself**.
- **No passwords.** You log in to WordPress, ChatGPT and Search Console yourself, in their browser windows. The app
  stores no passwords or Application Passwords, and it never types credentials.
- **ChatGPT** runs in a normal Chrome window with your own extension. The app uses no automation flags, no stealth
  tricks and no CAPTCHA solving.
- **`data/` is private.** It holds the database, your browser logins, screenshots and images, and it is git-ignored.
  Back it up, never share it, and treat `data/profiles` like passwords.
- **The dashboard is protected.** Every change needs a signed-in user and a CSRF token. Article HTML is sanitised.
  Logs hide anything that looks like a credential.

---

## Running without the dev server

```powershell
npm run build
npm run start:all
```

To start it with Windows, make a Task Scheduler task. Set it to run `npm run start:all` in this folder at log-on.

## Updating

```powershell
git pull
npm install
npm run setup
```

Your data, settings and edited prompts are kept.

## Configuration (`.env`)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | SQLite file. Default: `file:../data/app.db`. |
| `SESSION_SECRET` | Signs the login cookie. `npm run setup` fills it in. |
| `BROWSER_CHANNEL` | Browser for WordPress profiles: `chrome` (default), `msedge` or `chromium`. |
| `CHROME_PATH` | Full path to `chrome.exe`, if Chrome is not in the usual place. |
| `APP_URL` | Dashboard address, used by the Automation Chrome start page. Default: `http://localhost:3000`. |
| `SERPER_API_KEY` | Optional. Google results for the Plagiarism Check (https://serper.dev). |

## Folders

```
data/app.db           database (articles, settings, queue, logs)
data/profiles/        one Chrome profile per website (logins: keep private)
data/chatgpt-chrome/  the Automation Chrome profile (ChatGPT login)
data/media/           article images
data/logos/           logos for the image template
data/screenshots/     screenshots taken when something fails
data/tools/           optional face detector and Upscayl
extension/            the ChatGPT Worker extension (Load unpacked)
```

---

## Troubleshooting

| Problem | What to do |
|---|---|
| "Worker offline" at the top | Start the app with `npm run dev:all`, not only `npm run dev`. |
| "Extension not connected" | Open the Automation Chrome. Check the extension popup shows "Connected"; if not, create a new connection key in Settings and paste it again. |
| Article is stuck on "Login required" | Log in to ChatGPT in the Automation Chrome, or to WordPress with **Websites → Login**. Then press **Retry** on the article. |
| ChatGPT stops writing in the background | The Automation Chrome window was minimized. Restore it and keep it behind other windows instead. |
| Port 3000 is in use | Close the other program, or change the port in `package.json` and `APP_URL`. |
| A website's session expired | **Websites → open the website → Login**, then **Test Session**. |

## Development

```powershell
npm run typecheck
npm test
```

- The unit and integration tests use a temporary SQLite database, a fake chatgpt.com page and a fake WordPress.
- The **extension tests** load the real unpacked extension into Chromium. Run `npx playwright install chromium`
  once, or set `EXTENSION_TEST_BROWSER` to a Chromium or Edge path. If no such browser is found, they are skipped.
- The optional **real WordPress test** runs only when `WP_E2E_ADMIN_URL` is set. It needs a logged-in profile in
  `WP_E2E_PROFILE_DIR`.

### How it fits together

- **`src/app`**: the Next.js dashboard and its routes. It never opens a browser.
- **`src/worker`**: one worker process. It handles the SQLite job queue (article, chatgpt, control, workflow,
  humanizer and plagiarism), the pipeline engine and the writers. It also drives WordPress through Playwright and
  runs the image tools.
- **`extension/`**: the MV3 ChatGPT Worker extension. It claims prompts from `/api/extension/agent`, types them on
  chatgpt.com and sends the answers back.
- **`src/core`**: pure logic with unit tests. This includes the parsers, assembly, SEO checks, the publish guard,
  the humanizer locks, plagiarism matching and workflow time slots.
- **`src/modules`**: the writer modules and their default prompts.
