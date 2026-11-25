# MemoraFind

MemoraFind is a free grave finder for Bamberg County, South Carolina. Families, descendants and genealogy researchers search one cemetery at a time — Bamberg County Memory Gardens, Capernaum Cemetery or Honey Ford Cemetery — by first name, maiden name or last name, and by birth or death year. Every result shows the cemetery and the dates the record carries, and links to that person's own page at `/grave/<record id>`.

## Table of Contents

1. [About the Project](#about-the-project)
1. [Project Status](#project-status)
1. [Design](#design)
    1. [Design System](#design-system)
    1. [Colour and Contrast](#colour-and-contrast)
1. [Stack and Project Layout](#stack-and-project-layout)
1. [Routes](#routes)
    1. [Search Behaviour](#search-behaviour)
    1. [Dates, Age and Placeholders](#dates-age-and-placeholders)
    1. [The Single-Record Page](#the-single-record-page)
    1. [The Record-Update Flow](#the-record-update-flow)
1. [Getting Started](#getting-started)
    1. [Dependencies](#dependencies)
    1. [Getting the Source](#getting-the-source)
    1. [Environment Variables](#environment-variables)
    1. [Running It Locally](#running-it-locally)
    1. [Deploying](#deploying)
    1. [Error logs](#error-logs)
1. [Known Issues and What Is Not Built Yet](#known-issues-and-what-is-not-built-yet)
1. [How to Get Help](#how-to-get-help)
1. [Contributing](#contributing)
1. [License](#license)
1. [Authors](#authors)
1. [Acknowledgments](#acknowledgments)

## About the Project

<a href="https://memorafind.com" target="_blank"> Live Demo </a>
<hr>

MemoraFind is a community-focused web application dedicated to helping individuals locate and learn more about their loved ones buried in cemeteries across Bamberg County, South Carolina. It covers three cemeteries — Bamberg County Memory Gardens, Capernaum Cemetery and Honey Ford Cemetery.

🔍 Core Features:
* **Search the burial records:** find a record by first name, maiden name, last name, birth year or death year. The name filters are partial, case-insensitive matches; the year filters are exact. A middle name is shown on the record when one is stored; it is not a search field.
* **A page of its own for every record:** the person's name on a search result is the address of their page at `/grave/<record id>`, and the Record ID badge beside it is a second link to the same page — a stable link you can send to a relative, showing the name as given names, then the maiden name inline, then the surname, and a comma only before a suffix ("Louise A Orr Abel", "James S Anderson, Jr."), plus the dates, age, cemetery and veteran flag.
* **Cemetery and record facts on every result:** each result is a card led by the name and the dates the record carries, followed by the cemetery, the age where one is recorded, and the burial location when the page can show one. The card writes the name in the same order as the person's own page: given names, then the maiden name inline with no "née", then the surname, and ", suffix" only when a suffix was recorded. See [The Single-Record Page](#the-single-record-page). A burial-location row is printed only for a stored section or lot the page is willing to show; the invented sections in the source data are left off, and a record with neither gets no row at all rather than a guessed place (see [Known Issues and What Is Not Built Yet](#known-issues-and-what-is-not-built-yet)). Where a record carries `notes` or a relocation note (`moved_from` / `moved_to`), the card shows it under "More details".
* **Secure record updates:** a visitor can look a record up and read it, but changing it requires the administrator password, and only the fields that actually changed are written, so the data stays accurate and protected.
* **A correction path that works:** every found record page offers **Report a correction**, which opens a GitHub issue already carrying the person's name, cemetery, born and died dates and the record's own URL, with prompts for what is wrong, what it should say and the source — plus the same details as a prefilled email to memorafind@gmail.com for visitors without a GitHub account, and the Contact Us page as a third way. Nothing is retyped, and no page sends a visitor to a sign-in that does not exist.

💡 Motivation:
This project was inspired by the need for a centralized, easy-to-use tool that helps families stay connected to their heritage. Whether you're tracing your family tree or simply honoring a loved one, MemoraFind exists to make those moments easier and more meaningful.

More features and enhancements are on the way — because every memory matters.

**[Back to top](#table-of-contents)**

## Project Status

[![Netlify Status](https://api.netlify.com/api/v1/badges/a232b03e-0cfb-48f2-ac44-0b4113546fe5/deploy-status)](https://app.netlify.com/sites/memorafind/deploys)

The site is live and searchable at **https://memorafind.com**. `www.memorafind.com` redirects to that apex. `memorafind.netlify.app` serves the same pages and does not redirect; every canonical URL and Open Graph URL is still `https://memorafind.com/...`. The interface described under [Design](#design) below is the site's design: it is merged and deployed, not a branch waiting on review.

The sitemap the site serves lists 2,433 addresses: the home page, Contact Us, the three cemetery searches, and 2,428 grave pages for memorial IDs 1000001–1002428, with none missing in that range. The scraper CSVs, and the grave pages at each range's ends, split them into Bamberg County Memory Gardens 1,815 (1000001–1001815), Capernaum Cemetery 346 (1001816–1002161) and Honey Ford Cemetery 267 (1002162–1002428).

Everything a visitor can reach works, including the Contact Us page at `/contact`, which shows the public address memorafind@gmail.com. All three cemeteries search once a name or a year is entered; a cemetery page with no filter lists nothing and runs no query. Every record has a page at `/grave/<record id>`, and on a search result both the person's name and the Record ID badge link to it; the administrator's update route resolves at `/search/update`; an unknown cemetery, an unknown record, or any other unknown address gets a real page in the site's own design rather than a bare line of text.

The burial location is still the gap the source data cannot close: two records store an invented section, none store a lot, and the pages leave that row off rather than guessing. Photos, biographies and family connections remain open decisions rather than unfinished code — see [Known Issues and What Is Not Built Yet](#known-issues-and-what-is-not-built-yet).

**[Back to top](#table-of-contents)**

## Design

The look of the site is a small hand-written design system: two plain stylesheets, `public/css/tokens.css` (colour, type, spacing and focus tokens) and `public/css/styles.css` (the page and component styles), both linked from the shared header partial. There is no CSS framework and no CDN — nothing is fetched from a third party, no stylesheet is generated at build time, and the stylesheets are served as static files from `public/css/`. Headings are set in a serif stack and record data in a system sans-serif; no webfont is downloaded.

Every page is rendered in this design, with the same header, footer, navigation and type: the landing page, Contact Us, a cemetery search, a grave, the administrator login and update form, "cemetery not found", "record not found", "that is not a record ID", the unreadable-record page, the friendly error page (`error.ejs`), and the static 404 (`not-found.ejs`, committed as `public/404.html`).

### Design System

| Token | Value | Where it is used |
| --- | --- | --- |
| Burgundy | `hsl(358, 72%, 21%)` | site headers, navigation and headings |
| Gold | `hsl(45, 95%, 45%)` | buttons, borders and highlights |
| Page background | `#faf8f3` | the warm off-white behind every page |

### Colour and Contrast

The stylesheets keep to one accessibility rule: **gold is never body or link text on the cream page**, because gold on `#faf8f3` only reaches about 2.0:1 — far below the 4.5:1 minimum for text. On the cream page gold is used only as a fill, a border, an underline or a highlight wash. Where text does sit on a gold fill, it is near-black, about 8.4:1. Burgundy on the cream background is about 12.9:1 and carries the headings, navigation and links.

**[Back to top](#table-of-contents)**

## Stack and Project Layout

MemoraFind runs on Node.js, EJS, Netlify Functions and Supabase. That stack is fixed: there is no framework migration, no bundler and no build step.

* **Pages — `public/views/`.** Every page is an EJS template: `index.ejs` (the landing page), `contact.ejs` (Contact Us; the page shows the public address memorafind@gmail.com), `search.ejs` (a cemetery's results), `grave.ejs` (one record), `update.ejs` (the administrator's lookup and edit form), `login.ejs` (the administrator login), `cemetery-not-found.ejs`, `grave-not-found.ejs`, `grave-unavailable.ejs` (the record could not be read), `error.ejs` (the friendly error page) and `not-found.ejs` (an address that matches no route).
* **Shared partials — `public/views/partials/`.** `header.ejs` (document head plus site header and navigation), `footer.ejs` (footer, the mobile-navigation script, and the browser error reporter), `search-fields.ejs` (the reusable search form fields), `record-display.ejs` (the date, "Not recorded" and age rules, shared by the search card and the record page so the two cannot drift) and `fact-burial-location.ejs` (the burial-location fact, shared by the same two templates for the same reason).
* **Server code — `netlify/functions/`.** One file per route. Each handler does its work and returns HTML rendered with `ejs.renderFile`. The route handlers are `renderIndex.js`, `renderContact.js` (Contact Us, from `public/views/contact.ejs`), `renderSearch.js`, `renderGrave.js`, `getUpdateRecord.js`, `updatePage.js`, `updateRecord.js`, `login.js`, `logout.js`, `sitemap.js` (`/sitemap.xml`) and `logClientError.js` (browser error reports). `findCemetery.js` is a shared helper that locates a record by Memorial ID across the three cemeteries — it is not a route. `baseRecord.js` is the other shared helper: it names each cemetery's base table and composes the date string the templates read. `adminSession.js` holds the signed session and lockout, and is not a route. `errorReport.js` writes one structured JSON log line and the friendly error page; it is not a route. See [Error logs](#error-logs).
* **Data — Supabase.** The burial records live in Supabase. The functions read the project URL and key from the environment. Administrator sign-in is a signed session checked in the functions (see [Environment Variables](#environment-variables)).
* **Records pipeline — `python-scraper/`.** A Python script using BeautifulSoup that parses the cemetery listing pages into the CSV files committed alongside it (`parsed_names_bcmg.csv`, `parsed_names_capernaum.csv`, `parsed_names_honeyford.csv`), which is where the records in the database came from. What the source pages do and do not contain is what decides what the site can show — see the burial-location issue below.
* **Static assets — `public/`.** Stylesheets are served from `/css/...`. Cemetery photographs and the share image (`og-card.png`, 1200×630) are served from `/assets/...`. Capernaum's card still uses `placeholder.png`. `public/robots.txt` is that static file, not a function: it allows normal crawling, points crawlers at `https://memorafind.com/sitemap.xml`, and disallows `/.netlify/` plus the admin routes (`updatePage`, `login`, `logout`, `updateRecord`, `getUpdateRecord`, and `/search/update`) and the client error log. `/sitemap.xml` is not a file in `public/`. `netlify/functions/sitemap.js` builds it on each request from Supabase (home, Contact Us, the three cemetery searches, and every grave page) and `netlify.toml` redirects `/sitemap.xml` to that function with `force = true`. `node tools/build-sitemap.js` only checks that the scraper CSVs still hold 2,428 IDs, 1000001–1002428 (1,815, 346 and 267). It does not write a sitemap.
* **Tools — `tools/`.** `verify-review-fixes.js` runs the handlers and templates against a stub database. `build-404.js` renders `not-found.ejs` into `public/404.html`. `build-sitemap.js` checks the CSV memorial IDs. None of them is a Netlify build command.
* **Issue forms — `.github/ISSUE_TEMPLATE/`.** `config.yml` turns blank issues off and adds a Contact link to https://memorafind.com/contact. `bug_report.yml`, `feature_request.yml` and `record_correction.yml` are the three forms. See [Contributing](#contributing).
* **Contributor rules — `AGENTS.md`.** The short list of rules at the repository root: the frozen search form contract, the colour rule, "no invented data", and the fact that `netlify.toml` and the Supabase queries are changed only deliberately, with the owner's clearance.
* **No build step — `netlify.toml`.** Netlify publishes `public/` exactly as it is committed and runs the functions from `netlify/functions/`. `[functions] included_files = ["public/views/**"]` is what ships the EJS templates together with the functions, so every template has to stay under `public/views/`. There is nothing to compile. The only generated file committed from a tool is `public/404.html` (`node tools/build-404.js` after `not-found.ejs` or a shared partial changes). `/sitemap.xml` is the `sitemap` function, not a committed file. `[build.environment]` sets `SECRETS_SCAN_OMIT_KEYS = "ADMIN_EMAIL"` because the administrator email is intentionally public on the Contact Us page (memorafind@gmail.com, the same value as `ADMIN_EMAIL`). Netlify's secret scan would otherwise fail the build when it sees that address in the template. Scanning itself stays on; only that key is omitted.

**[Back to top](#table-of-contents)**

## Routes

Pretty URLs are Netlify redirects in `netlify.toml`, all with `status = 200`, so the function's HTML is served at that address. Each function is also reachable directly at `/.netlify/functions/<name>`. `/robots.txt` and an unknown address are static files, not redirects.

| Route | Function | Template | What it renders |
| --- | --- | --- | --- |
| `/` | `renderIndex` | `public/views/index.ejs` | the landing page: the quick search form, the three cemetery cards, the explanation of how to report a correction, and the links to the three cemeteries |
| `/contact` | `renderContact` | `public/views/contact.ejs` | the Contact Us page, which shows the public address memorafind@gmail.com |
| `/search/:cemetery` | `renderSearch` | `public/views/search.ejs` | the results for one cemetery. `:cemetery` must be `bcmg` (Bamberg County Memory Gardens), `capernaum` or `honeyford`; any other value is answered with the site's own "Cemetery not found" page and a `404` status |
| `/grave/<record id>` | `renderGrave` | `public/views/grave.ejs` | one person's record — see [The Single-Record Page](#the-single-record-page) |
| `/search/update` | `getUpdateRecord` | `public/views/update.ejs` | the administrator's lookup-and-edit page — see [The Record-Update Flow](#the-record-update-flow). `noindex`; `robots.txt` disallows it |
| `/sitemap.xml` | `sitemap` | — | XML sitemap of the home page, Contact Us, the three cemetery searches, and every grave page, read from Supabase. The browser cache header is `public, max-age=3600`. The function also sets `Netlify-CDN-Cache-Control` to a day, with stale-while-revalidate for a day; Netlify does not echo that header to the browser. A failure is a short `503`, `Cache-Control: no-store`, and no URL list |
| `/robots.txt` | — | `public/robots.txt` | the static crawl rules above. Not generated |
| any path with no redirect and no file | — | `public/404.html` | "This page does not exist", status `404`, `noindex`, no canonical. Regenerated with `node tools/build-404.js` after `not-found.ejs` or a shared partial changes |

Two things about that table are worth knowing:

* `/search/update` is listed in `netlify.toml` **before** the `/search/:cemetery` rule, which is `force = true`. Redirects are matched in order, so `/search/update` reaches `getUpdateRecord` and is not read as a cemetery named `update`.
* `/grave/` is a splat rule (`/grave/*`) rather than a path parameter, for the same reason: a `force = true` rule on `/search/:cemetery` would swallow anything starting `/search/`. The splat also matches `/grave/` on its own, so an address with no record ID reaches the function and gets its own page rather than a Netlify default.

The landing page's quick-search form needs the chosen cemetery in the *path* (`/search/<cemetery>`), which a plain form action cannot build, so its submit is intercepted by a small inline script that assembles the URL and the query string. That is why the form element itself still posts to `/search` while every search the site serves lives at `/search/<cemetery>?<filters>`.

### Search Behaviour

On `/search/:cemetery` the filters travel as query-string parameters: `lastName`, `firstName`, `maidenName`, `birthYear` and `deathYear` — the same names the form always submitted. At least one of them has to carry a value. The three name filters are partial, case-insensitive matches, the year filters are exact matches, and results are ordered by last name.

* **Names are partial and case-insensitive.** `?lastName=Wil` finds both "Wilkes" and "Williams". On Bamberg County Memory Gardens that search reports 65 matching records and shows the first 50; Capernaum reports 12 and Honey Ford reports 8, so those two lists are not capped. A typed percent sign, underscore or backslash matches that character. Leading and trailing spaces are trimmed, so a field holding only spaces counts as blank.
* **Years are exact, and have to be four digits.** `?birthYear=1952` matches 1952 and nothing else. The form's year fields suggest 1700–2050; the handler still accepts any four-digit year. A value that is not four digits — `?birthYear=abc` — does not go to the database at all: the count line says "Search not run" and the page heading is "That is not a valid year". It says nothing about who is or is not recorded, and it never reports a database problem, because the database was never asked.
* **A query string is not the same thing as a search.** `/search/bcmg`, `/search/bcmg?x=1` and `/search/bcmg?lastName=&firstName=&maidenName=&birthYear=&deathYear=` carry nothing to filter on. A value that is only spaces counts as blank, and an unknown query key is ignored. The handler lists nothing and runs no query: the page shows the search form and one line, "Type a last name, a maiden name, or a birth year above…". It is not a list of that cemetery's records, and the 50-row cap does not apply, because the database is not asked. The canonical URL of every search, including one with filters, is `https://memorafind.com/search/<cemetery>` with no query string.
* **Results are capped at 50 rows, and the count is honest about it.** The cap is part of the query (`RESULT_LIMIT`), not of the template, and the same request also asks Supabase for the exact number of rows matching the whole filter. When more records match than fit, the page says so: `65 records found — showing the first 50`, with a line underneath that these are the first 50 of 65 and a suggestion to narrow the search. When the database reports no total and 50 rows came back, the page says "At least 50 records match" rather than inventing a total.
* **A search that matches nothing says "0 records found."** It is counted like any other result, and the empty state below it agrees.
* **A cemetery whose records could not be read says so.** If Supabase cannot be reached, the page says the record database is temporarily unavailable and that this says nothing about who is recorded there — it never presents an outage as "no such person". The real error goes to the function log, never into the response body.
* **A cemetery name that is not one of the three** gets the site's own "Cemetery not found" page — header, footer, the three real cemeteries and a way back to the search — with a `404` status, `noindex`, and no canonical URL.

### Dates, Age and Placeholders

The record views compute zero for a date part they could not work out, and for an age they could not compute (which includes a death in the same year as the birth). **A zero is never printed as a real date part or a real age.**

* `1967–2020`, never `00/0/1967`. A part that was never recorded is left out: the view shows `03/29/1915` when the month, day and year are all recorded, `11/1971` when only the month and year are, and `1967` when only the year is.
* A date the record carries nothing usable for reads **Not recorded**, in the muted style, rather than a row of zeros.
* **There is no Age row at all when there is no usable age** — the row is omitted rather than shown as `Age 0`.
* The same rules are applied by a single shared partial (`public/views/partials/record-display.ejs`), so a person's dates read identically on the search card and on their own page.

### The Single-Record Page

Every record has a page of its own at `/grave/<record id>`, and on each search result both the person's name and the Record ID badge are links to it. The heading writes given names, then the maiden name inline with no "née", then the surname, and ", suffix" only when a suffix was recorded — "Louise A Orr Abel", or "James S Anderson, Jr.". The page title, the breadcrumb, the description, and the Open Graph and Twitter titles use that same order. The description names the person, the dates the record actually carries, the cemetery and the record ID. The canonical URL is `https://memorafind.com/grave/<record id>`. Open Graph and Twitter repeat that title and description; the share image is the site card at `/assets/og-card.png` (1200×630, `summary_large_image`), not a photograph of the person. The page also publishes JSON-LD for a Person: the same name, `url`, `birthDate` and `deathDate` when a year was recorded (a missing month or day is left out, not written as zero), and `burialPlace` set to the cemetery, inside Bamberg County, South Carolina, when the record has one. The prefix and a Veteran badge are shown where the record carries them. The page also shows the birth and death dates, the age where there is a usable one, the cemetery, a burial location only when one can be shown, and the record ID again. A search result card writes that same name order: the maiden name is inline in the heading, and there is no "née" line under the name.

It is built only from data the site already holds, and there is deliberately no more than that on it: no photographs, no biography and no family links. It is a stable address, so it can be pasted into a message or a family history, and its page title and description are built from that name, the years the record actually carries and the cemetery, so a shared link describes the right person. A note at the foot of a found record offers **Report a correction**. That link opens the GitHub issue form `.github/ISSUE_TEMPLATE/record_correction.yml` in a new tab with the issue title and body already filled in: the person's name, the cemetery, the born and died dates the page shows, and the record's own URL, followed by three short prompts — what is wrong, what it should say, and the source or evidence. A GitHub issue form ignores per-field query parameters, so those facts travel in the issue `body`, which is what keeps the visitor from retyping the name, dates and ID. Filing it needs a free GitHub account, so the same note also offers **send the same details by email** — a `mailto:` to memorafind@gmail.com with subject and body prefilled from the same facts and prompts, needing no account at all — and still points to the [Contact page](/contact) as a third way. The link is not shown when the record is missing or the ID is not a number, and it is not on search results, the landing page, Contact Us, the administrator pages, or the friendly error page. One link returns to that cemetery's search. The other returns to the home search (`/#search`), where the visitor chooses one cemetery. There is no search that queries all three cemeteries in one request.

The page is honest in each of its failure cases, and all of them keep the site's design:

| Address | Answer |
| --- | --- |
| `/grave/1001728` (a real record) | the record, `200`, indexable, with its own canonical URL |
| `/grave/` or `/grave/ABC` (not a record ID) | "That is not a record ID", `404`, `noindex`, no canonical — no lookup is attempted, so this cannot be confused with a missing record |
| `/grave/999999999` (a well-formed ID that matches nothing) | "Record not found", `404`, `noindex`, no canonical |
| any record ID, when the database cannot be read | "This record could not be read", `503`. The page keeps that grave's canonical URL and is not `noindex`, so an outage does not ask a crawler to drop the person. It says the record could not be looked up rather than claiming the person does not exist |

### The Record-Update Flow

A visitor can look a record up and read it, but changing anything requires the administrator password:

1. The record's **Record ID** (`memorial_id`) is shown on each search result card and on the record's own page. "Update a record" in the header and footer leads to the gate below.
2. `/.netlify/functions/updatePage` is that gate: with no valid session cookie it renders the login page, and with a signed session it renders the update page.
3. On the login page the administrator enters the password. The form posts that password and nothing else. A hidden username control has no `name`, so the browser can treat the form as a sign-in while the control is not submitted. The page says the session expires in 10 minutes. `/.netlify/functions/login` compares the password with `ADMIN_PASSWORD_HASH` (or `ADMIN_PASSWORD`) using a constant-time check and, on success, sets an `HttpOnly`, `Secure`, `SameSite=Strict` `mf_session` cookie that expires after ten minutes. The cookie is HMAC-SHA256 signed with `ADMIN_SESSION_SECRET`. A wrong password re-renders the login page. Five failed attempts lock that client out for 15 minutes — see [Environment Variables](#environment-variables). The login page is `noindex` and has no canonical URL. The update page is `noindex` too; its canonical URL is `https://memorafind.com/search/update`.
4. `/search/update` (served by `/.netlify/functions/getUpdateRecord`) is the lookup, and it requires that same session. The administrator enters a Memorial ID, and the function looks that record up across the three cemeteries and renders its current values into the edit form — or a message, if the ID matches nothing. A value that is not a number is answered as bad input ("A Memorial ID is a number, for example 1001728") rather than being sent to the database and reported as an outage.
5. Submitting the edit form POSTs to `/.netlify/functions/updateRecord`, which requires a valid session, writes only allowlisted fields that actually changed, and re-renders the page with a success or an error message. The write signs in to Supabase Auth as the administrator and updates with that user's access token. The token stays on the server (see [Environment Variables](#environment-variables)).
6. `/.netlify/functions/logout` clears the session cookie with the same attributes, forgets that session id in the function's memory, and redirects to `/`.

**[Back to top](#table-of-contents)**

## Getting Started

### Dependencies

Node.js and npm. `npm install` installs what `package.json` lists. The handlers that read or save records use `@supabase/supabase-js`, and every HTML page is rendered with `ejs`. `netlify-cli` is a devDependency, so `npm start` runs the local Netlify dev server without a global install. Nothing is compiled and no global tooling is required.

### Getting the Source

HTTPS:

```
git clone https://github.com/dyarawilliams/MemoraFind.git
```

SSH:

```
git clone git@github.com:dyarawilliams/MemoraFind.git
```

### Environment Variables

Set these in the Netlify site's environment settings. For local development, copy `.env.example` to `.env` and replace the placeholders. None of the values are recorded in this repository. `.env`, `node_modules` and the local `.netlify` folder are the only entries in `.gitignore`, so `.env` is not committed. `npm start` runs `netlify dev`, and the Netlify CLI loads `.env` into the process the functions run in. A name already set in the shell is left as it is. Otherwise the `.env` value is the one the functions see, including when the linked site stores the same name. The handlers read `process.env`. A build on Netlify uses the site's environment settings and does not read `.env`. Public search needs the two Supabase variables. Administrator sign-in also needs `ADMIN_EMAIL`, `ADMIN_SESSION_SECRET` (16 or more characters) and either `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` — without them, login fails closed and no session cookie is issued. A save signs in to Supabase Auth as `ADMIN_EMAIL`. `SUPABASE_ADMIN_PASSWORD` is optional: the save uses it when it is set, and falls back to `ADMIN_PASSWORD` when it is unset or empty.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | the Supabase project URL the functions query |
| `SUPABASE_API_KEY` | the anon key the functions use to read records. The save path starts a Supabase client with this key and then signs in; row-level security does not allow this key to update the tables |
| `ADMIN_EMAIL` | must be the Supabase Auth user's email. The login form posts a password only; this address is not typed in. The signed session stores it, and the save path signs in to Supabase Auth with it. The Contact Us page publishes the same address (memorafind@gmail.com). `netlify.toml` sets `SECRETS_SCAN_OMIT_KEYS = "ADMIN_EMAIL"` so Netlify's secret scan does not fail the build on that public address |
| `ADMIN_PASSWORD` | the site administrator password, compared in constant time. Ignored for site login when `ADMIN_PASSWORD_HASH` is set. Used as the Supabase Auth password when `SUPABASE_ADMIN_PASSWORD` is unset or empty |
| `ADMIN_PASSWORD_HASH` | preferred over `ADMIN_PASSWORD` for site login. A scrypt hash in the form `scrypt:<salt hex>:<key hex>`. This does not replace `SUPABASE_ADMIN_PASSWORD` |
| `SUPABASE_ADMIN_PASSWORD` | optional. That Supabase Auth user's password, when it differs from the site `ADMIN_PASSWORD`. The save path signs in with this when it is set, and falls back to `ADMIN_PASSWORD` when it is unset or empty |
| `ADMIN_SESSION_SECRET` | HMAC secret for the session cookie and the lockout cookie. 16 or more characters, random |
| `SENTRY_DSN` | optional. When set to an `https` Sentry DSN, the functions also send the same scrubbed error report to Sentry. When it is unset or empty, that send does not run and no Sentry account is required. See [Error logs](#error-logs). Do not commit the value |

Generate `ADMIN_PASSWORD_HASH` with Node's built-in scrypt (the same defaults the login check uses):

```
node -e "const c=require('crypto');const p=process.argv[1];const s=c.randomBytes(16);const k=c.scryptSync(p,s,32);console.log('scrypt:'+s.toString('hex')+':'+k.toString('hex'))" 'your-password'
```

**Session cookie.** On success, login sets `mf_session`: `HttpOnly`, `Secure`, `SameSite=Strict`, path `/`, ten-minute expiry, HMAC-SHA256 signed with `ADMIN_SESSION_SECRET`. `Secure` means the browser stores it on HTTPS, which is how Netlify serves production and deploy previews. Logout clears that cookie with the same attributes and forgets the session id in that isolate's memory.

**Lockout.** Five failed attempts lock the client out for 15 minutes. The counter is kept in function memory (per client address, in that isolate) and in a signed `mf_fail` cookie, and the stricter of the two wins. This is best-effort on serverless: a new isolate starts with an empty memory counter, and a caller that drops the cookie avoids the copy it was holding. No Supabase table was added, so lockout does not need a schema change.

**Saves and row-level security.** Row-level security is enabled on `bcmg_data`, `capernaum_data` and `honeyford_data`. The anon key in `SUPABASE_API_KEY` can read, and a write with that key alone changes zero rows. With row-level security on, a save that has no matching policy silently changes nothing: the update is accepted and zero rows are written. `updateRecord` still requires the signed `mf_session` cookie before it does anything. On the server it then signs in to Supabase Auth as `ADMIN_EMAIL`, using `SUPABASE_ADMIN_PASSWORD` when that optional variable is set and falling back to `ADMIN_PASSWORD` when it is unset or empty, with `supabase.auth.signInWithPassword` on a fresh client created with `persistSession: false`. The update and the `select('*')` that returns the changed row run as that user. The access token stays in the function isolate until it is near expiry; a write that comes back unauthorized refreshes the session or signs in again. The token is never written to a cookie, the response, or the log. If sign-in fails, the function log says `Supabase admin sign-in failed` and the page shows "Error Updating Record. Please try again." A write that changes zero rows is a different failure: the page says nothing was saved. Reads — the edit form, search, and the record page — still use `SUPABASE_API_KEY` alone, because those selects are allowed without a user session. Administrator saves through this path are confirmed working in production.

Each table needs a `SELECT` policy named `Admin can read <table>` and an `UPDATE` policy named `Admin can update <table>`, both for the `authenticated` role. The `using` expression, and `with check` on the update policy, compare `auth.jwt()->>'email'` to the administrator's address. The statements below use the placeholder `your-admin@example.com`. Substitute the address stored in `ADMIN_EMAIL` when you run them. Do not commit that address.

```sql
create policy "Admin can read bcmg_data"
  on public.bcmg_data
  for select
  to authenticated
  using (auth.jwt()->>'email' = 'your-admin@example.com');

create policy "Admin can update bcmg_data"
  on public.bcmg_data
  for update
  to authenticated
  using (auth.jwt()->>'email' = 'your-admin@example.com')
  with check (auth.jwt()->>'email' = 'your-admin@example.com');

create policy "Admin can read capernaum_data"
  on public.capernaum_data
  for select
  to authenticated
  using (auth.jwt()->>'email' = 'your-admin@example.com');

create policy "Admin can update capernaum_data"
  on public.capernaum_data
  for update
  to authenticated
  using (auth.jwt()->>'email' = 'your-admin@example.com')
  with check (auth.jwt()->>'email' = 'your-admin@example.com');

create policy "Admin can read honeyford_data"
  on public.honeyford_data
  for select
  to authenticated
  using (auth.jwt()->>'email' = 'your-admin@example.com');

create policy "Admin can update honeyford_data"
  on public.honeyford_data
  for update
  to authenticated
  using (auth.jwt()->>'email' = 'your-admin@example.com')
  with check (auth.jwt()->>'email' = 'your-admin@example.com');
```

These two queries check the policies and the table grants that are already in place:

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('bcmg_data', 'capernaum_data', 'honeyford_data')
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('bcmg_data', 'capernaum_data', 'honeyford_data')
  and privilege_type in ('SELECT', 'UPDATE')
order by table_name, grantee, privilege_type;
```

### Running It Locally

`npm install`, then copy `.env.example` to `.env` and fill in at least `SUPABASE_URL` and `SUPABASE_API_KEY`. `npm start` runs `netlify dev`. That command reads `netlify.toml`: it publishes `public/`, runs the functions in `netlify/functions/`, and applies the redirects, which is how Netlify serves the site. The CLI ignores a `start` script whose command contains `netlify dev` when it looks for an app server, so it serves `public/` as static files and does not launch `npm start` a second time. No `[dev]` block is required.

The dev server listens on port 8888. It serves the site from the local `.env` without a Netlify login. `netlify login` and `netlify link` also pull the linked site's environment variables. A name set in `.env` is still the value the functions see, unless that name is already exported in the shell.

`npm test` runs `node tools/verify-review-fixes.js`. That checks the handlers and templates against a stub database. No request leaves the process. The script sets the environment variables it needs, so it does not read `.env`.

`package.json` still names `app.js` as `main`. That file is not in the repository. `npm start` and `npm test` do not use it.

Two other tools stay as direct Node commands:

* `node tools/build-sitemap.js` — checks that the three CSVs still hold memorial IDs 1000001–1002428. It does not write a sitemap.
* `node tools/build-404.js` — rewrites `public/404.html` from `not-found.ejs`. `node tools/build-404.js --check` exits 1 if that file is stale.

A change to a page is also checked on the Netlify deploy preview that Netlify builds for a branch or pull request. The live site is served by Netlify.

### Deploying

Deployment is done by Netlify from this repository. `netlify.toml` publishes `public/` as static files and deploys the functions in `netlify/functions/`, with the EJS templates included in that deployment so the functions can render them. There is no build command and nothing to run by hand: push a branch (or open a pull request) and Netlify builds a preview of it, and the deploy-status badge above reports the latest deploy for the site.

### Error logs

Function errors are one JSON line on the Netlify function log: `level` (`error`), `function` (the handler name), `path` (no query string), `message`, `stack`, and `timestamp`. The line does not include the request body, cookies, or the values of `SUPABASE_API_KEY`, `ADMIN_PASSWORD`, `SUPABASE_ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, or `SENTRY_DSN`. A visitor sees `public/views/error.ejs` ("Something went wrong", `noindex`, no canonical, `Cache-Control: no-store`) or the page that handler already used for that failure, such as "this record could not be read", instead of a stack trace.

To read them: open the site in the Netlify dashboard, then **Logs** (or **Functions**, pick the function, and open its log). Filter for `"level":"error"`. A browser error (`window.onerror` or an unhandled promise rejection) is posted by the footer script to `logClientError`. The script sends at most five reports per page view. That endpoint accepts a small JSON body, prefixes the kind on the message (`error:` or `unhandledrejection:`), keeps the stack and the page path, drops every other field, and stops answering an address that posts more than 20 reports in 10 minutes. The limit lives in that isolate's memory, the same way admin lockout does. `robots.txt` disallows the endpoint.

Sentry is optional. In **Site configuration → Environment variables**, set `SENTRY_DSN` to the DSN from a Sentry project (a free project is enough). Redeploy so the functions see it. Leave the variable unset to keep every report in the Netlify log only. The code sends the report itself; there is no Sentry package to install, and the DSN is never written into the repository.

After this is deployed, submit `https://memorafind.com/sitemap.xml` in [Google Search Console](https://search.google.com/search-console) (Sitemaps). The site already has `SUPABASE_URL` and `SUPABASE_API_KEY`; the sitemap uses that same public read. No new variable is required for the sitemap.

**[Back to top](#table-of-contents)**

## Known Issues and What Is Not Built Yet

* **The burial location is missing from the source data.** Of the 2,428 records in the scraper CSVs, 2,426 have neither a section nor a lot. The other two are both at Bamberg County Memory Gardens and store an invented section: `BAMBERG` on record 1000365, and `MARKER` on record 1001420. No row stores a lot. The saved Bamberg County Memory Gardens listing has two "Plot info" lines, `bamberg county memory` and `Marker only`; the Capernaum and Honey Ford listings have none, so re-scraping would not produce a location. The burial-location row is omitted for those two values. The page also omits a stored section of `2011`; no CSV row stores that value. A record with no usable section or lot shows no burial-location row at all — the page does not say "Section and lot not recorded", and it does not guess. Any other stored section or lot is shown as stored. Until the plots are collected by hand (walking the cemeteries or working from photographs) or come from the cemeteries or the county library, the site cannot say where a grave is.
* **Administrator saves are confirmed working in production.** A save signs in to Supabase Auth as `ADMIN_EMAIL`, using `SUPABASE_ADMIN_PASSWORD` when that optional variable is set and falling back to `ADMIN_PASSWORD` when it is unset or empty. The handlers are also checked with a stub database (`node tools/verify-review-fixes.js`), including login, lockout, logout, a rejected anonymous save, the field allowlist, a missing cemetery, a Supabase sign-in that supplies the access token for the update, a Supabase sign-in that fails, the sitemap, the record page's description and structured data, the grave page's correction link and its prefilled email link, and the error log. The harness runs **336 checks and reports 0 failed**.
* **Photos, biographies and family connections are not built.** No photograph, biography or family relationship is stored in or read from the data, and none of them appear in the interface. They need new data structures in the Supabase project and a decision on who moderates a stranger's contribution to someone's memorial before any of it can start. The nearest the site comes today is the free-text `notes` and the `moved_from` / `moved_to` relocation fields, which a search card and a record page show under "More details" when the record actually carries one.

**[Back to top](#table-of-contents)**

## How to Get Help

Site visitors can use the Contact Us page at [/contact](https://memorafind.com/contact) or email memorafind@gmail.com.

Contact me at dyara.williams@gmail.com for help with this project.

**[Back to top](#table-of-contents)**

## Contributing

Contributions are welcome. Open an issue or a pull request on [GitHub](https://github.com/dyarawilliams/MemoraFind). Blank issues are off (`blank_issues_enabled: false` in `.github/ISSUE_TEMPLATE/config.yml`). The issue chooser offers three forms and a link to the [Contact page](https://memorafind.com/contact):

* **Bug report** (`.github/ISSUE_TEMPLATE/bug_report.yml`) — what broke, how to reproduce it, and the page URL.
* **Feature request** (`.github/ISSUE_TEMPLATE/feature_request.yml`) — the problem, then a proposed change. The stack is fixed.
* **Record correction** (`.github/ISSUE_TEMPLATE/record_correction.yml`) — a wrong or missing burial record. The cemetery choices are the three display names. A found grave page's **Report a correction** link opens this form with the issue title and body already filled in — the person's name, cemetery, born and died dates and the record's URL, then prompts for what is wrong, what it should say and the source. GitHub issue forms ignore per-field query parameters, which is why those facts travel in the issue `body`. The same facts are also offered as a prefilled `mailto:` to memorafind@gmail.com for visitors without a GitHub account.

There is no `CONTRIBUTING.md` or code of conduct in the repository yet, and the stack (Node.js + EJS + Supabase + Netlify Functions, with no build step) is fixed, so please raise anything larger than a fix in an issue first. `AGENTS.md` at the repository root lists the rules a change has to keep to — the frozen search form contract, the colour rule, and "never print a placeholder as if it were data".

**[Back to top](#table-of-contents)**

## License

`package.json` lists `"license": "ISC"`. No `LICENSE` file is present in this repository, so this document does not grant a license.

**[Back to top](#table-of-contents)**

## Authors

* **[D'yara Williams](https://github.com/dyarawilliams)** - *Initial work* - [MemoraFind](https://memorafind.com/)

Also see the list of [contributors](https://github.com/dyarawilliams/MemoraFind/contributors) who participated in this project.

**[Back to top](#table-of-contents)**

## Acknowledgments

Big Thank you to Claire (@mayanwolfe) for her guidance and providing the template for this project.

**[Back to top](#table-of-contents)**
