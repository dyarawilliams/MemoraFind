# AGENTS.md — rules for MemoraFind contributors

MemoraFind is a free grave finder for Bamberg County, South Carolina: a family
member or genealogy researcher searches the burial records of three cemeteries
and is told where the grave is. `README.md` describes the routes, the record-update
flow and how the site is deployed. This file is the short list of rules that any
AI or human contributor has to follow.

## Stack and layout

- Node.js + EJS + Supabase + Netlify Functions. That stack is fixed: no framework
  migration, no bundler, no CSS framework, no new runtime dependency.
- **There is no build step.** Nothing is compiled and no output is generated:
  `netlify.toml` publishes `public/` exactly as it is committed and runs the
  handlers in `netlify/functions/`.
- Static files are served from `public/` (`/css/...`, `/assets/...`), every page
  is an EJS template under `public/views/`, and there is one handler per route in
  `netlify/functions/`.
- Work lands on a feature branch with a pull request. The owner reviews the
  Netlify **deploy preview** for that PR; nothing is pushed straight to `main`.

## Ask the owner before you touch these

Get explicit clearance for that specific change first:

- the Supabase database schema;
- the Supabase queries in `netlify/functions/`;
- `python-scraper/`, which produced the records that are in the database now.

Rewriting a query or re-scraping changes the data the whole site shows, so it is
never a side effect of another task. If something there is clearly broken, say so
and wait for a decision before changing it.

## Keep `netlify.toml` as it is

`netlify.toml` is the whole deployment: `[build] publish = "public"` and
`functions = "netlify/functions"`, three `[[redirects]]` that give the functions
their pretty URLs, and `[functions] included_files = ["public/views/**"]`. A change
there is a change to how the live site routes and deploys, so it has to be minimal
and deliberate — never a drive-by edit, and never a new redirect added to chase a
symptom somewhere else.

- `/.netlify/functions/<name>` is reachable directly and answers any caller. That
  is why `/.netlify/` is disallowed in `public/robots.txt`.
- `included_files = ["public/views/**"]` is what ships the templates to the
  functions, so every template has to stay under `public/views/` — a template
  moved elsewhere stops rendering.

## Frozen — do not change without saying so

- **Form actions and field names.** The search form's `action` and every input's
  `name` (`lastName`, `firstName`, `maidenName`, `birthYear`, `deathYear`) are a
  public contract. Markup and CSS may be redesigned; what the form submits, and
  where it submits to, may not change as part of that.
- **The colour rule.** Burgundy (`hsl(358, 72%, 21%)`) carries headings, navigation
  and links on the cream page (`#faf8f3`), at about 12.9:1. Gold
  (`hsl(45, 95%, 45%)`) is a fill, a border, an underline or a highlight wash only:
  **gold is never body or link text on cream**, because that is about 2.0:1, far
  below the 4.5:1 minimum. Text sitting on a gold fill is near-black.
- **No invented data.** A date part that was never recorded is never printed as a
  zero placeholder: the page says it is not recorded, rather than showing
  `00/0/1967` or `Age 0`. The same applies to the burial location — if the record
  has no section or lot, the page says so instead of printing a guessed value.

## Working conventions

- Before reading or editing anything, run `git log -1 --oneline HEAD` and compare
  it with `git log -1 --oneline origin/main`. This working tree is shared and has
  been left on a stale commit, which silently produces edits against the wrong
  version of a file.
- Never **move or delete** a file out of `public/` to build a preview or a fixture
  render — copy it. If `git status --short` shows `D public/...`, restore it with
  `git checkout HEAD -- public` and never commit the deletion.
- Finish with the default branch checked out, fast-forwarded to `origin/main`, and
  `git status --short` empty.
- `.env`, `node_modules/` and `.netlify/` are the only ignored entries. Never commit
  credentials or a `.env` file; `SUPABASE_URL` and `SUPABASE_API_KEY` come from the
  environment.
