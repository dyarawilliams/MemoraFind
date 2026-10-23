# MemoraFind

MemoraFind is a free grave finder for Bamberg County, South Carolina. Families, descendants and genealogy researchers search the burial records of three cemeteries by first name, maiden name or last name — and by birth or death year — and every result shows the cemetery and the dates the record carries, and links to that person's own page at `/grave/<record id>`.

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
* **Search the burial records:** find a record by first name, middle name, maiden name, last name, birth year or death year. The name filters are partial, case-insensitive matches; the year filters are exact.
* **A page of its own for every record:** the Record ID on a search result is the address of that person's page at `/grave/<record id>` — a stable link you can send to a relative, showing the name, maiden name, dates, age, cemetery and veteran flag.
* **Cemetery and record facts on every result:** each result is a card led by the name and the dates the record carries, followed by the cemetery, the age where one is recorded, and the burial location. A section and lot are printed only where the record actually holds one; otherwise the card says so in words rather than guessing (see [Known Issues and What Is Not Built Yet](#known-issues-and-what-is-not-built-yet)). Where a record carries `notes` or a relocation note (`moved_from` / `moved_to`), the card shows it under "More details".
* **Secure record updates:** a visitor can look a record up and read it, but changing it requires the administrator password, and only the fields that actually changed are written, so the data stays accurate and protected.

💡 Motivation:
This project was inspired by the need for a centralized, easy-to-use tool that helps families stay connected to their heritage. Whether you're tracing your family tree or simply honoring a loved one, MemoraFind exists to make those moments easier and more meaningful.

More features and enhancements are on the way — because every memory matters.

**[Back to top](#table-of-contents)**

## Project Status

[![Netlify Status](https://api.netlify.com/api/v1/badges/a232b03e-0cfb-48f2-ac44-0b4113546fe5/deploy-status)](https://app.netlify.com/sites/memorafind/deploys)

The site is live and searchable at **https://memorafind.com** (the `memorafind.netlify.app` address serves the same site, and `www` redirects to the apex `memorafind.com`). The interface described under [Design](#design) below is the site's design: it is merged and deployed, not a branch waiting on review.

Everything a visitor can reach works. All three cemeteries search, filtered and unfiltered; every record has a page at `/grave/<record id>` linked from its search result; the administrator's update route resolves at `/search/update`; an unknown cemetery or an unknown record gets a real page in the site's own design rather than a bare line of text.

The one headline promise the site cannot keep is the burial location, because the section and lot are not in the source data. That, the shape of the memory features, and the wording of the landing page are open decisions rather than unfinished code — see [Known Issues and What Is Not Built Yet](#known-issues-and-what-is-not-built-yet).

**[Back to top](#table-of-contents)**

## Design

The look of the site is a small hand-written design system: two plain stylesheets, `public/css/tokens.css` (colour, type, spacing and focus tokens) and `public/css/styles.css` (the page and component styles), both linked from the shared header partial. There is no CSS framework and no CDN — nothing is fetched from a third party, no stylesheet is generated at build time, and the stylesheets are served as static files from `public/css/`. Headings are set in a serif stack and record data in a system sans-serif; no webfont is downloaded.

Every page — including the two "not found" pages and the one that reports an unreadable record — is rendered in this design, with the same header, footer, navigation and type.

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

* **Pages — `public/views/`.** Every page is an EJS template: `index.ejs` (the landing page), `search.ejs` (a cemetery's results), `grave.ejs` (one record), `update.ejs` (the administrator's lookup and edit form), `login.ejs` (the administrator login), and three states that used to be plain text — `cemetery-not-found.ejs`, `grave-not-found.ejs` and `grave-unavailable.ejs`.
* **Shared partials — `public/views/partials/`.** `header.ejs` (document head plus site header and navigation), `footer.ejs` (footer and the small mobile-navigation script), `search-fields.ejs` (the reusable search form fields), `record-display.ejs` (the date, "Not recorded" and age rules, shared by the search card and the record page so the two cannot drift) and `fact-burial-location.ejs` (the burial-location fact, shared by the same two templates for the same reason).
* **Server code — `netlify/functions/`.** One file per route. Each handler does its work and returns HTML rendered with `ejs.renderFile`. `findCemetery.js` is a shared helper that locates a record by Memorial ID across the three cemeteries — it is not a route. `search.js` is a legacy handler that no route reaches any more (see [Known Issues and What Is Not Built Yet](#known-issues-and-what-is-not-built-yet)).
* **Data — Supabase.** The burial records and the administrator account live in Supabase. The functions read the project URL and key from the environment (see [Environment Variables](#environment-variables)).
* **Records pipeline — `python-scraper/`.** A Python script using BeautifulSoup that parses the cemetery listing pages into the CSV files committed alongside it (`parsed_names_bcmg.csv`, `parsed_names_capernaum.csv`, `parsed_names_honeyford.csv`), which is where the records in the database came from. What the source pages do and do not contain is what decides what the site can show — see the burial-location issue below.
* **Static assets — `public/`.** Stylesheets are served from `/css/...` and the cemetery photographs from `/assets/...`. `public/robots.txt` allows normal crawling and disallows `/.netlify/` (the function endpoints answer any caller, so they are kept out of the index), and `public/sitemap.xml` lists the landing page, the three cemetery search pages and **all 2,428 grave pages** (`/grave/<memorial id>`), so every person's page can be found by a search engine now that a cemetery search page lists nothing until a visitor searches. The sitemap is generated from the record CSVs, never edited by hand: run `node tools/build-sitemap.js` after the records change and commit the result (`node tools/build-sitemap.js --check` reports a stale file, and refuses to build at all if the CSVs no longer hold the 2,428 IDs 1000001–1002428 it expects).
* **Contributor rules — `AGENTS.md`.** The short list of rules at the repository root: the frozen search form contract, the colour rule, "no invented data", and the fact that `netlify.toml` and the Supabase queries are changed only deliberately, with the owner's clearance.
* **No build step — `netlify.toml`.** Netlify publishes `public/` exactly as it is committed and runs the functions from `netlify/functions/`. `[functions] included_files = ["public/views/**"]` is what ships the EJS templates together with the functions, so every template has to stay under `public/views/`. There is nothing to compile. The only generated files are `public/404.html` and `public/sitemap.xml`, both committed from the tools in `tools/` (`build-404.js`, `build-sitemap.js`) — nothing generates them during a deploy, so they have to be regenerated and committed when what they are built from changes.

**[Back to top](#table-of-contents)**

## Routes

Pretty URLs are Netlify redirects in `netlify.toml`, all with `status = 200`, so the function's HTML is served at that address. Each function is also reachable directly at `/.netlify/functions/<name>`.

| Route | Function | Template | What it renders |
| --- | --- | --- | --- |
| `/` | `renderIndex` | `public/views/index.ejs` | the landing page: the quick search form, the three cemetery cards, the explanation of the update process, and the links to the three cemeteries |
| `/search/:cemetery` | `renderSearch` | `public/views/search.ejs` | the results for one cemetery. `:cemetery` must be `bcmg` (Bamberg County Memory Gardens), `capernaum` or `honeyford`; any other value is answered with the site's own "Cemetery not found" page and a `404` status |
| `/grave/<record id>` | `renderGrave` | `public/views/grave.ejs` | one person's record — see [The Single-Record Page](#the-single-record-page) |
| `/search/update` | `getUpdateRecord` | `public/views/update.ejs` | the administrator's lookup-and-edit page — see [The Record-Update Flow](#the-record-update-flow) |

Two things about that table are worth knowing:

* `/search/update` is listed in `netlify.toml` **before** the `/search/:cemetery` rule, which is `force = true`. Redirects are matched in order, so `/search/update` reaches `getUpdateRecord` and is not read as a cemetery named `update`.
* `/grave/` is a splat rule (`/grave/*`) rather than a path parameter, for the same reason: a `force = true` rule on `/search/:cemetery` would swallow anything starting `/search/`. The splat also matches `/grave/` on its own, so an address with no record ID reaches the function and gets its own page rather than a Netlify default.

The landing page's quick-search form needs the chosen cemetery in the *path* (`/search/<cemetery>`), which a plain form action cannot build, so its submit is intercepted by a small inline script that assembles the URL and the query string. That is why the form element itself still posts to `/search` while every search the site serves lives at `/search/<cemetery>?<filters>`.

### Search Behaviour

On `/search/:cemetery` the filters travel as query-string parameters: `lastName`, `firstName`, `maidenName`, `birthYear` and `deathYear` — the same names the form always submitted. The three name filters are partial, case-insensitive matches, the year filters are exact matches, and results are ordered by last name.

* **Names are partial and case-insensitive.** `?lastName=Wil` finds both "Wilkes" and "Williams" — on the live site it reports 65 matching records. Leading and trailing spaces are trimmed, so a field holding only spaces counts as blank.
* **Years are exact, and have to be years.** `?birthYear=1952` matches 1952 and nothing else. A hand-typed value that is not a four-digit year — `?birthYear=abc` — does not go to the database at all: the page says the year is not valid, states that the search was not run, and says nothing about who is or is not recorded. It never reports a database problem, because the database was never asked.
* **A query string is not the same thing as a search.** `/search/bcmg?x=1` and `/search/bcmg?lastName=&firstName=&maidenName=&birthYear=&deathYear=` carry nothing to filter on, so they render the same browse list as `/search/bcmg` itself — the first 50 records of the cemetery, listed by last name — rather than an unfiltered query of their own. Unknown query keys are ignored.
* **Results are capped at 50 rows, and the count is honest about it.** The cap is part of the query (`RESULT_LIMIT`), not of the template, and the same request also asks Supabase for the exact number of rows matching the whole filter. When more records match than fit, the page says so: `65 records found — showing the first 50`, with a line underneath repeating that these are the first 50 of 65 and suggesting a narrower search. A total the database did not report is never invented — the page then states how many rows it is showing instead of a total it cannot support.
* **A search that matches nothing says "0 records found."** It is counted like any other result, and the empty state below it agrees.
* **A cemetery whose records could not be read says so.** If Supabase cannot be reached, the page says the record database is temporarily unavailable and that this says nothing about who is recorded there — it never presents an outage as "no such person". The real error goes to the function log, never into the response body.
* **A cemetery name that is not one of the three** gets the site's own "Cemetery not found" page — header, footer, the three real cemeteries and a way back to the search — with a `404` status.

### Dates, Age and Placeholders

The record views compute zero for a date part they could not work out, and for an age they could not compute (which includes a death in the same year as the birth). **A zero is never printed as a real date part or a real age.**

* `1967–2020`, never `00/0/1967`. A part that was never recorded is left out: the view shows `03/29/1915` when the month, day and year are all recorded, `11/1971` when only the month and year are, and `1967` when only the year is.
* A date the record carries nothing usable for reads **Not recorded**, in the muted style, rather than a row of zeros.
* **There is no Age row at all when there is no usable age** — the row is omitted rather than shown as `Age 0`.
* The same rules are applied by a single shared partial (`public/views/partials/record-display.ejs`), so a person's dates read identically on the search card and on their own page.

### The Single-Record Page

Every record has a page of its own at `/grave/<record id>`, and the Record ID badge on each search result is the link to it. It shows the name as the card writes it (last name, then given names and suffix, with the prefix and a Veteran badge where the record carries them), the maiden name where there is one, the birth and death dates, the age where there is a usable one, the cemetery, the burial location as the record holds it, and the record ID again.

It is built only from data the site already holds, and there is deliberately no more than that on it: no photographs, no biography and no family links. It is a stable address, so it can be pasted into a message or a family history, and its page title and description are built from the name, the years the record actually carries and the cemetery, so a shared link describes the right person. A note at the foot of the page asks a reader who spots a mistake to quote the record ID to a library administrator. Links take the visitor back to that cemetery's search and to the search across all three.

The page is honest in each of its failure cases, and all of them keep the site's design:

| Address | Answer |
| --- | --- |
| `/grave/1001728` (a real record) | the record, `200` |
| `/grave/` or `/grave/ABC` (not a record ID) | "That is not a record ID", `404` — no lookup is attempted, so this cannot be confused with a missing record |
| `/grave/999999999` (a well-formed ID that matches nothing) | "Record not found", `404` |
| any record ID, when the database cannot be read | "This record could not be read", `503` — the page says the record could not be looked up rather than claiming the person does not exist |

### The Record-Update Flow

A visitor can look a record up and read it, but changing anything requires the administrator password:

1. The record's **Record ID** (`memorial_id`) is shown on each search result card and on the record's own page. "Update a record" in the header and footer leads to the gate below.
2. `/.netlify/functions/updatePage` is that gate: with no session cookie it renders the login page, and with a valid one it renders the update page.
3. On the login page the administrator enters the password. `/.netlify/functions/login` checks it against the site's administrator account in Supabase and, on success, sets an `httpOnly` `token` cookie that expires after ten minutes and renders the update page. A wrong password re-renders the login page with a message.
4. `/search/update` (served by `/.netlify/functions/getUpdateRecord`) is the lookup: the administrator enters a Memorial ID, and the function looks that record up across the three cemeteries and renders its current values into the edit form — or a message, if the ID matches nothing. A value that is not a number is answered as bad input ("A Memorial ID is a number, for example 1001728") rather than being sent to the database and reported as an outage.
5. Submitting the edit form POSTs to `/.netlify/functions/updateRecord`, which requires the `token` cookie, writes only the fields that actually changed to Supabase, and re-renders the page with a success or an error message.
6. `/.netlify/functions/logout` clears the cookie and redirects to `/`.

**[Back to top](#table-of-contents)**

## Getting Started

### Dependencies

Node.js and npm. `npm install` installs the runtime dependencies listed in `package.json` (EJS and the Supabase client among them). Nothing is compiled and no global tooling is required.

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

The functions read two variables from the environment:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | the Supabase project URL the functions query |
| `SUPABASE_API_KEY` | the key the functions use to reach that project |

Set both in the Netlify site's environment settings, or in a local `.env` file (`.env`, `node_modules` and the local `.netlify` folder are the only entries in `.gitignore`). The values belong to the site's own Supabase project and are not recorded in this repository.

### Running It Locally

`npm install` is all the setup the project needs, and the same two environment variables have to be present in the environment. Note that there is no local entry point in this repository: the `start` script in `package.json` points at a `server.js` that is not part of the repository, because every page is rendered by a Netlify Function rather than by a server checked in here. In practice a change is therefore checked on the Netlify deploy preview that Netlify builds for a branch or pull request, and the site itself is only ever served by Netlify.

### Deploying

Deployment is done by Netlify from this repository. `netlify.toml` publishes `public/` as static files and deploys the functions in `netlify/functions/`, with the EJS templates included in that deployment so the functions can render them. There is no build command and nothing to run by hand: push a branch (or open a pull request) and Netlify builds a preview of it, and the deploy-status badge above reports the latest deploy for the site.

**[Back to top](#table-of-contents)**

## Known Issues and What Is Not Built Yet

* **The burial location is missing from the source data.** Every record renders "Section and lot not recorded", and that is the honest answer: 2,425 of the 2,428 records have no section or lot at all, and the three that show a value show a wrong one that our own pattern-matching invented from unrelated words on the source page ("Section BAMBERG", "Section MARKER", "Section 2011"). The scraper reads Find a Grave's "Plot info" line, which for these three cemeteries contains only `bamberg county memory` or `Marker only` — so re-scraping would not produce a location. Until the plots are collected by hand (walking the cemeteries or working from photographs) or come from the cemeteries or the county library, the site cannot say where a grave is. The page never guesses: where a record does carry a section or lot it is shown, and otherwise the fact says it was not recorded.
* **The landing page still promises a section and lot.** The hero copy and the "See where the grave is" step both say a search shows the section and the lot, which the data cannot support. Rewording that promise is a decision for the site's owner, so the wording is unchanged for now and this bullet records the gap rather than hiding it. (This README deliberately makes no such promise.)
* **The administrator login-and-save path has never been tested end to end.** Every part of it exists and resolves, but no administrator account is held by the people who built it, so the path from entering the password, through `login`, `getUpdateRecord` and `updateRecord`, to a saved change has never been exercised against the live database. The pages before the gate have been checked; the save has not.
* **Photos, biographies and family connections are not built.** No photograph, biography or family relationship is stored in or read from the data, and none of them appear in the interface. They need new data structures in the Supabase project and a decision on who moderates a stranger's contribution to someone's memorial before any of it can start. The nearest the site comes today is the free-text `notes` and the `moved_from` / `moved_to` relocation fields, which a search card and a record page show under "More details" when the record actually carries one.
* **The legacy `search.js` function is still deployed.** It is a second, older copy of the search handler, still deployed as the endpoint `/.netlify/functions/search`, and no route in `netlify.toml` points at it — every search the site serves goes through `renderSearch` and `search.ejs`. It is left in place rather than deleted so that removing it is a deliberate change of its own.

**[Back to top](#table-of-contents)**

## How to Get Help

Contact me at dyara.williams@gmail.com for help with this project.

**[Back to top](#table-of-contents)**

## Contributing

Contributions are welcome. Open an issue or a pull request on [GitHub](https://github.com/dyarawilliams/MemoraFind). There is no `CONTRIBUTING.md` or code of conduct in the repository yet, and the stack (Node.js + EJS + Supabase + Netlify Functions, with no build step) is fixed, so please raise anything larger than a fix in an issue first. `AGENTS.md` at the repository root lists the rules a change has to keep to — the frozen search form contract, the colour rule, and "never print a placeholder as if it were data".

**[Back to top](#table-of-contents)**

## License

No license file is present in this repository yet, so no license is granted by this document.

**[Back to top](#table-of-contents)**

## Authors

* **[D'yara Williams](https://github.com/dyarawilliams)** - *Initial work* - [MemoraFind](https://memorafind.com/)

Also see the list of [contributors](https://github.com/dyarawilliams/MemoraFind/contributors) who participated in this project.

**[Back to top](#table-of-contents)**

## Acknowledgments

Big Thank you to Claire (@mayanwolfe) for her guidance and providing the template for this project.

**[Back to top](#table-of-contents)**
