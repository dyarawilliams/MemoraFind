# MemoraFind

A free, public grave finder for **Bamberg County, South Carolina**. Families, descendants and genealogy researchers search one cemetery at a time by name and year, open a stable page for one person's grave, and report a correction if something is wrong.

**Live at [memorafind.com](https://memorafind.com)** · [![Netlify Status](https://api.netlify.com/api/v1/badges/a232b03e-0cfb-48f2-ac44-0b4113546fe5/deploy-status)](https://app.netlify.com/sites/memorafind/deploys)

## Coverage

| Cemetery | Records |
| --- | --- |
| Bamberg County Memory Gardens | 1,815 |
| Capernaum Cemetery | 346 |
| Honey Ford Cemetery | 267 |
| **Total** | **2,428** |

That is 3 of the 133 cemeteries Find a Grave lists for the county. The site's sitemap lists 2,433 addresses: every grave page, plus the home page, Contact Us and the three cemetery searches.

## What it does

- **Search by cemetery** — by first name, maiden name, last name, birth year or death year. Names are partial, case-insensitive matches; years are exact. No records are listed until a visitor enters a usable name or year, results are capped at 50, and the count states the true total.
- **A page per person** — every record has a permanent address at `/grave/<record id>`, with its own title, description, canonical URL and structured data so search engines can index it and a family can share it.
- **A correction path that works** — every found record page offers *Report a correction*, which opens a GitHub issue already carrying the person's name, cemetery, born and died dates and the record's link, with prompts for what is wrong, what it should say and the source. The same details are offered as a prefilled email for visitors without a GitHub account, with the Contact Us page as a third way.
- **Honest failure pages** — a missing record, an unknown cemetery and an unreadable database each get their own page in the site's design, and an outage never reads as "no such person".
- **Administrator editing** — records are read-only to visitors; changing one requires a password-gated session, and only the fields that actually changed are written.

## Stack

Node.js, EJS, Netlify Functions and Supabase. No framework, no bundler, no build step — Netlify publishes `public/` as committed and runs the functions in `netlify/functions/`.

| Path | What lives there |
| --- | --- |
| `public/views/` | one EJS template per page, plus `partials/` shared by them |
| `public/css/` | `tokens.css` (colour, type, spacing) and `styles.css` |
| `public/assets/` | cemetery photographs and the share card |
| `netlify/functions/` | one handler per route, rendering the templates |
| `netlify.toml` | redirects, publish settings, no build command |
| `python-scraper/` | the scraper and CSVs the records came from |
| `tools/` | offline checks (see below) |
| `AGENTS.md` | the rules a change has to keep to |

## Routes

| Route | What it renders |
| --- | --- |
| `/` | the landing page and quick search |
| `/contact` | Contact Us |
| `/search/<cemetery>` | results for one cemetery — `bcmg`, `capernaum` or `honeyford` |
| `/grave/<record id>` | one person's record |
| `/search/update` | the administrator's lookup-and-edit page (`noindex`) |
| `/sitemap.xml` | generated from Supabase on each request |
| `/robots.txt`, unknown paths | static files |

## Getting started

Requires Node.js and npm.

```bash
git clone https://github.com/dyarawilliams/MemoraFind.git
cd MemoraFind
npm install
cp .env.example .env      # then fill in at least SUPABASE_URL and SUPABASE_API_KEY
npm start                 # netlify dev — serves the site on http://localhost:8888
npm test                  # offline harness, 336 checks, no database needed
```

Public search needs only `SUPABASE_URL` and `SUPABASE_API_KEY`. Administrator sign-in also needs `ADMIN_EMAIL`, `ADMIN_SESSION_SECRET` and either `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`; without them login fails closed. `SUPABASE_ADMIN_PASSWORD` and `SENTRY_DSN` are optional. Full descriptions, the password-hash command and the database policies are in [docs/reference.md](docs/reference.md).

`node tools/build-404.js` regenerates `public/404.html` after a template or shared partial changes; `node tools/build-sitemap.js` checks the scraper CSVs still hold the 2,428 memorial IDs.

**Deploying** is Netlify's job: push a branch or open a pull request and it builds a preview; a merge to `main` publishes the site. Set the environment variables in the Netlify site settings — a build reads those, not `.env`.

## Known limitations

- **No burial location.** 2,426 of the 2,428 records store neither a section nor a lot, so the page leaves that row off rather than guessing. Plot data has to be collected by hand before the site can say where a grave is.
- **No paging past 50 results.** A common-name search says how many records match but cannot show more than the first 50.
- **No photos, biographies or family links.** They need new storage and a moderation decision before any of it can be built.

## Contributing and help

Issues and pull requests are welcome. Blank issues are off; the issue chooser offers a bug report, a feature request and a record correction, plus a link to [Contact Us](https://memorafind.com/contact). Anything larger than a fix is worth an issue first — the stack is fixed, and `AGENTS.md` lists the rules a change must keep to (the frozen search form contract, the colour rule, and never printing a placeholder as if it were data).

Site visitors: [Contact Us](https://memorafind.com/contact) or memorafind@gmail.com. Project questions: dyara.williams@gmail.com.

## License and credits

`package.json` lists `"license": "ISC"`; no `LICENSE` file is present, so this document grants no license.

Built by [D'yara Williams](https://github.com/dyarawilliams). Thanks to Claire ([@mayanwolfe](https://github.com/mayanwolfe)) for her guidance and the project template.
