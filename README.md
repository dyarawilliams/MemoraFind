# MemoraFind

MemoraFind is a free grave finder for Bamberg County, South Carolina. Families, descendants and genealogy researchers search the burial records by first name, maiden name or last name — and by birth or death year — and every result shows the cemetery and where in that cemetery the grave is, down to the section and lot.

## Table of Contents

1. [About the Project](#about-the-project)
1. [Project Status](#project-status)
1. [The Redesigned Interface](#the-redesigned-interface)
    1. [Design System](#design-system)
    1. [Colour and Contrast](#colour-and-contrast)
1. [Stack and Project Layout](#stack-and-project-layout)
1. [Routes](#routes)
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

<a href="https://memorafind.netlify.app" target="_blank"> Live Demo </a>
<hr>

MemoraFind is a community-focused web application dedicated to helping individuals locate and learn more about their loved ones buried in cemeteries across Bamberg County, South Carolina. It covers three cemeteries — Bamberg County Memory Gardens, Capernaum Cemetery and Honey Ford Cemetery.

🔍 Core Features:
* **Search the burial records:** find a record by first name, middle name, maiden name, last name, birth year or death year. The name filters are partial matches; the year filters are exact. (Filtered searches currently fail on the live site — see [Known Issues and What Is Not Built Yet](#known-issues-and-what-is-not-built-yet).)
* **Cemetery and burial location on every result:** each result is a card led by the name and dates, followed by the cemetery and the burial location — the section and lot — so a visit can be planned without guesswork. Where the record carries notes or a relocation note, the card shows them under "More details".
* **Secure record updates:** a visitor can look a record up, but changing it requires the administrator password, so the data stays accurate and protected.

💡 Motivation:
This project was inspired by the need for a centralized, easy-to-use tool that helps families stay connected to their heritage. Whether you're tracing your family tree or simply honoring a loved one, MemoraFind exists to make those moments easier and more meaningful.

More features and enhancements are on the way — because every memory matters.

**[Back to top](#table-of-contents)**

## Project Status

[![Netlify Status](https://api.netlify.com/api/v1/badges/a232b03e-0cfb-48f2-ac44-0b4113546fe5/deploy-status)](https://app.netlify.com/sites/memorafind/deploys)

The site is live and searchable. The redesigned interface described below is built on the `redesign/public-frontend` branch and is waiting on review before it is merged.

**[Back to top](#table-of-contents)**

## The Redesigned Interface

The look of the site is a small hand-written design system: two plain stylesheets, `public/css/tokens.css` (colour, type, spacing and focus tokens) and `public/css/styles.css` (the page and component styles), both linked from the shared header partial. There is no CSS framework and no CDN — nothing is fetched from a third party, no stylesheet is generated at build time, and the stylesheets are served as static files from `public/css/`. Headings are set in a serif stack and record data in a system sans-serif; no webfont is downloaded.

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

* **Pages — `public/views/`.** Every page is an EJS template (`index.ejs`, `search.ejs`, `login.ejs`, `update.ejs`). The partials they share live in `public/views/partials/` — `header.ejs` (document head plus site header and navigation), `footer.ejs` (footer and the small mobile-navigation script) and `search-fields.ejs` (the reusable search form fields).
* **Server code — `netlify/functions/`.** One file per route. Each handler does its work and returns HTML rendered with `ejs.renderFile`; `findCemetery.js` is a shared helper that locates a record by Memorial ID across the cemeteries.
* **Data — Supabase.** The burial records and the administrator account live in Supabase. The functions read the project URL and key from the environment (see [Environment Variables](#environment-variables)).
* **Records pipeline — `python-scraper/`.** A Python script using BeautifulSoup that parses the cemetery listing pages into the CSV files committed alongside it (`parsed_names_bcmg.csv`, `parsed_names_capernaum.csv`, `parsed_names_honeyford.csv`), which is where the records in the database came from.
* **Static assets — `public/`.** Stylesheets are served from `/css/...` and the three cemetery photographs from `/assets/...`.
* **No build step — `netlify.toml`.** Netlify publishes `public/` exactly as it is committed and runs the functions from `netlify/functions/`. `[functions] included_files = ["public/views/**"]` is what ships the EJS templates together with the functions, so every template has to stay under `public/views/`. There is nothing to compile and no generated output in the repository.

**[Back to top](#table-of-contents)**

## Routes

Pretty URLs are Netlify redirects in `netlify.toml`, all with `status = 200`, so the function's HTML is served at that address. Each function is also reachable directly at `/.netlify/functions/<name>`.

| Route | Function | Template | What it renders |
| --- | --- | --- | --- |
| `/` | `renderIndex` | `public/views/index.ejs` | the landing page: the quick search form, the three cemetery cards and an explanation of the update process |
| `/search/:cemetery` | `renderSearch` | `public/views/search.ejs` | the results for one cemetery. `:cemetery` must be `bcmg`, `capernaum` or `honeyford`; any other value is answered with `404 Cemetery not found` |
| `/search/update` | `getUpdateRecord` | `public/views/update.ejs` | the administrator's lookup-and-edit page — see below |

On `/search/:cemetery` the filters travel as query-string parameters: `lastName`, `firstName`, `maidenName`, `birthYear` and `deathYear`. The three name filters are partial, case-insensitive matches; the year filters are exact matches. Results are ordered by last name.

**The `/search/update` route does not resolve today.** In `netlify.toml` the `/search/:cemetery` redirect is listed first and is `force = true`, so `/search/update` is read as the cemetery named `update`; that is not one of the three valid cemeteries, and the site answers `404 Cemetery not found`. The `/search/update` redirect to `getUpdateRecord` below it is never reached — which is also why the update page's "Start over" link leads to a 404.

A function called `search.js` also exists in `netlify/functions/`, but no route in `netlify.toml` reaches it.

### The Record-Update Flow

A visitor can look a record up and read it, but changing anything requires the administrator password:

1. The record's **Record ID** (`memorial_id`) is shown on each search result card; "Update a record" in the header and on the landing page leads to the gate.
2. `/.netlify/functions/updatePage` is that gate: with no session cookie it renders the login page, and with a valid one it renders the update page.
3. On the login page the administrator enters the password. `/.netlify/functions/login` checks it against the site's administrator account in Supabase and, on success, sets an `httpOnly` `token` cookie that expires after ten minutes and renders the update page. A wrong password re-renders the login page with a message.
4. On the update page the administrator enters a Memorial ID. `/.netlify/functions/getUpdateRecord` looks that record up across the three cemeteries and renders its current values into the edit form (or a message, if the ID matches nothing).
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

* **Filtered search returns an error.** On the live site a filtered search such as `/search/bcmg?lastName=smith` answers `500 Internal Server Error`. Browsing a cemetery unfiltered (`/search/bcmg`) works, so the fault is in how the filtered query is built rather than in the page. The fix belongs in a Supabase query under `netlify/functions/`, which this work deliberately leaves untouched.
* **`/search/update` returns 404.** The administrator's update page cannot be reached at that address because of the redirect ordering described under [Routes](#routes). The page itself is still reachable through the "Update a record" links, which call the functions directly.
* **There is no single-grave page.** No route, template or query renders one grave: a record appears only as a card in the search results. Giving one record a page of its own is a data-layer decision, not a styling one.
* **Photos, biographies and family connections are not built.** No photograph, biography or family relationship is stored in or read from the data, and none of them appear in the interface. The nearest the site comes today is the free-text `notes` and the `moved_from` / `moved_to` relocation fields, which the search cards show under "More details".

**[Back to top](#table-of-contents)**

## How to Get Help

Contact me at dyara.williams@gmail.com for help with this project.

**[Back to top](#table-of-contents)**

## Contributing

Contributions are welcome. Open an issue or a pull request on [GitHub](https://github.com/dyarawilliams/MemoraFind). There is no `CONTRIBUTING.md` or code of conduct in the repository yet, and the stack (Node.js + EJS + Supabase + Netlify Functions, with no build step) is fixed, so please raise anything larger than a fix in an issue first.

**[Back to top](#table-of-contents)**

## License

No license file is present in this repository yet, so no license is granted by this document.

**[Back to top](#table-of-contents)**

## Authors

* **[D'yara Williams](https://github.com/dyarawilliams)** - *Initial work* - [MemoraFind](https://memorafind.netlify.app/)

Also see the list of [contributors](https://github.com/dyarawilliams/MemoraFind/contributors) who participated in this project.

**[Back to top](#table-of-contents)**

## Acknowledgments

Big Thank you to Claire (@mayanwolfe) for her guidance and providing the template for this project.

**[Back to top](#table-of-contents)**
