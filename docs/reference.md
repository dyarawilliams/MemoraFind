# MemoraFind — reference

The detail behind [README.md](../README.md): exact behaviour, the administrator flow, the database policies and the logging. Everything here is checked against the live site or the offline harness.

## Contents

- [Design](#design)
- [Routes in detail](#routes-in-detail)
- [Search behaviour](#search-behaviour)
- [Dates, age and placeholders](#dates-age-and-placeholders)
- [The single-record page](#the-single-record-page)
- [The record-update flow](#the-record-update-flow)
- [Environment variables](#environment-variables)
- [Database policies](#database-policies)
- [Error logs](#error-logs)
- [Known issues in detail](#known-issues-in-detail)

## Design

Two hand-written stylesheets, both linked from the shared header partial: `public/css/tokens.css` (colour, type, spacing and focus tokens) and `public/css/styles.css` (page and component styles). No CSS framework, no CDN, nothing fetched from a third party, no stylesheet generated at build time. Headings are a serif stack and record data a system sans-serif; no webfont is downloaded.

| Token | Value | Where it is used |
| --- | --- | --- |
| Burgundy | `hsl(358, 72%, 21%)` | site headers, navigation and headings |
| Gold | `hsl(45, 95%, 45%)` | buttons, borders and highlights |
| Page background | `#faf8f3` | the warm off-white behind every page |

**One accessibility rule: gold is never body or link text on the cream page.** Gold on `#faf8f3` reaches only about 2.0:1, far below the 4.5:1 minimum for text, so on the cream page it is used only as a fill, a border, an underline or a highlight wash. Text on a gold fill is near-black, about 8.4:1. Burgundy on cream is about 12.9:1 and carries headings, navigation and links.

Every page uses that design, including the failure pages: "cemetery not found", "record not found", "that is not a record ID", the unreadable-record page, the friendly error page (`error.ejs`) and the static 404 (`not-found.ejs`, committed as `public/404.html`).

## Routes in detail

Pretty URLs are Netlify redirects in `netlify.toml`, all with `status = 200`, so a function's HTML is served at that address. Each function is also reachable at `/.netlify/functions/<name>`.

| Route | Function | Template |
| --- | --- | --- |
| `/` | `renderIndex` | `index.ejs` |
| `/contact` | `renderContact` | `contact.ejs` |
| `/search/:cemetery` | `renderSearch` | `search.ejs` |
| `/grave/<record id>` | `renderGrave` | `grave.ejs` |
| `/search/update` | `getUpdateRecord` | `update.ejs` |
| `/sitemap.xml` | `sitemap` | — |
| any path with no redirect and no file | — | `public/404.html` |

Shared helpers that are not routes: `findCemetery.js` (locates a record by Memorial ID across the three cemeteries), `baseRecord.js` (names each cemetery's table and composes the date string), `adminSession.js` (signed session and lockout) and `errorReport.js` (one JSON log line plus the friendly error page).

Two ordering facts matter:

- `/search/update` is listed **before** `/search/:cemetery`, which is `force = true`. Redirects match in order, so the admin page is not read as a cemetery named `update`.
- `/grave/` is a splat (`/grave/*`), so `/grave/` on its own still reaches the function and gets its own page instead of a Netlify default.

The landing page's quick-search form needs the chosen cemetery in the *path*, which a plain form action cannot build, so a small inline script assembles the URL. The form element still posts to `/search`; every search the site serves lives at `/search/<cemetery>?<filters>`.

`/sitemap.xml` is a function, not a file. It sets `Cache-Control: public, max-age=3600` for the browser and `Netlify-CDN-Cache-Control` to a day with stale-while-revalidate for a day. A failure is a short `503` with `Cache-Control: no-store` and no URL list.

## Search behaviour

Filters travel as query-string parameters: `lastName`, `firstName`, `maidenName`, `birthYear`, `deathYear`. At least one must carry a value. Results are ordered by last name.

- **Names are partial and case-insensitive.** `?lastName=Wil` finds both "Wilkes" and "Williams". A typed percent sign, underscore or backslash matches that character. Leading and trailing spaces are trimmed, so a field of spaces counts as blank.
- **Years are exact and must be four digits.** `?birthYear=1952` matches 1952 only. A value that is not four digits — `?birthYear=abc` — never reaches the database: the count line says "Search not run" and the heading says "That is not a valid year", which says nothing about who is recorded.
- **A query string is not a search.** `/search/bcmg`, `?x=1` and an all-blank filter set list nothing and run no query; the page shows the form and one line of guidance. The canonical URL of every search is `https://memorafind.com/search/<cemetery>` with no query string.
- **Results are capped at 50, and the count is honest.** The cap is in the query (`RESULT_LIMIT`), and the same request asks Supabase for the exact total. More matches than fit reads `65 records found — showing the first 50` with a suggestion to narrow. With no total available and 50 rows back, it says "At least 50 records match" rather than inventing one.
- **Zero matches says "0 records found"**, counted like any other result.
- **An unreadable database says so.** The page says the record database is temporarily unavailable and that this says nothing about who is recorded; the real error goes to the function log, never into the response.
- **An unknown cemetery** gets the site's own "Cemetery not found" page with `404`, `noindex` and no canonical URL.

## Dates, age and placeholders

The views compute zero for a date part they could not work out, and for an age they could not compute (including a death in the birth year). **A zero is never printed as a real date part or a real age.**

- `1967–2020`, never `00/0/1967`. A part that was never recorded is left out: `03/29/1915` when month, day and year are recorded, `11/1971` with only month and year, `1967` with only the year.
- A date with nothing usable reads **Not recorded** in the muted style.
- **No Age row at all** when there is no usable age, rather than `Age 0`.
- One shared partial (`public/views/partials/record-display.ejs`) applies these rules, so a person's dates read identically on the search card and on their page.

## The single-record page

`/grave/<record id>` is built only from data the site already holds: no photographs, no biography, no family links.

- The heading writes given names, then the maiden name inline with no "née", then the surname, and ", suffix" only when one was recorded — "Louise A Orr Abel", "James S Anderson, Jr.". Title, breadcrumb, description and social titles use that same order.
- The description names the person, the dates the record carries, the cemetery and the record ID. Canonical URL is `https://memorafind.com/grave/<record id>`; the share image is the site card at `/assets/og-card.png` (1200×630), not a photograph of the person.
- JSON-LD `Person` publishes the same name, `url`, `birthDate` and `deathDate` when a year was recorded (a missing month or day is omitted, not zero), and `burialPlace` set to the cemetery inside Bamberg County.
- The foot of the page offers **Report a correction**. It opens the GitHub issue form with the issue title and body prefilled — name, cemetery, born and died dates, record URL — followed by prompts for what is wrong, what it should say and the source. GitHub issue forms ignore per-field query parameters, so the facts travel in `body`; that is what stops the visitor retyping them. Because filing needs a GitHub account, the same note offers a prefilled `mailto:` to memorafind@gmail.com and points to the Contact page.
- The link is not shown when the record is missing or the ID is not a number, and it is not on search results, the landing page, Contact Us, the admin pages or the error page.

Failure cases:

| Address | Answer |
| --- | --- |
| a real record | the record, `200`, indexable, own canonical URL |
| `/grave/` or `/grave/ABC` | "That is not a record ID", `404`, `noindex` — no lookup attempted, so it cannot be confused with a missing record |
| a well-formed ID that matches nothing | "Record not found", `404`, `noindex` |
| any ID when the database cannot be read | "This record could not be read", `503`, keeping the canonical URL and not `noindex`, so an outage does not ask a crawler to drop the person |

## The record-update flow

Visitors can read a record; changing one requires the administrator password.

1. The **Record ID** (`memorial_id`) is shown on each result card and on the record page. "Update a record" in the header and footer leads to the gate.
2. `/.netlify/functions/updatePage` renders the login page without a valid session cookie, and the update page with one.
3. The login form posts a password and nothing else. `/.netlify/functions/login` compares it with `ADMIN_PASSWORD_HASH` (or `ADMIN_PASSWORD`) in constant time and, on success, sets `mf_session`: `HttpOnly`, `Secure`, `SameSite=Strict`, path `/`, ten-minute expiry, HMAC-SHA256 signed with `ADMIN_SESSION_SECRET`. Five failed attempts lock that client out for 15 minutes.
4. `/search/update` requires that session. The administrator enters a Memorial ID; the record is looked up across the three cemeteries and its current values rendered into the edit form. A non-numeric ID is answered as bad input rather than sent to the database.
5. Submitting posts to `/.netlify/functions/updateRecord`, which requires a valid session, writes only allowlisted fields that actually changed, and re-renders with a success or an error. The write signs in to Supabase Auth as the administrator and runs as that user; the access token never leaves the server.
6. `/.netlify/functions/logout` clears the cookie, forgets the session id in that isolate and redirects to `/`.

**Lockout is best-effort on serverless.** The counter lives in function memory per client address and in a signed `mf_fail` cookie; the stricter of the two wins. A new isolate starts empty, and a caller that drops the cookie avoids that copy. No table was added, so no schema change was needed.

## Environment variables

Set these in the Netlify site's environment settings. For local work, copy `.env.example` to `.env`; `netlify dev` loads it into the process the functions run in. A name already exported in the shell is left alone.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | the Supabase project URL the functions query |
| `SUPABASE_API_KEY` | the anon key used to read records. Row-level security does not let this key update the tables |
| `ADMIN_EMAIL` | the Supabase Auth user's email. Not typed at login; stored in the session and used by the save path. The Contact page publishes the same address |
| `ADMIN_PASSWORD` | the site administrator password, compared in constant time. Ignored for login when `ADMIN_PASSWORD_HASH` is set; used as the Supabase Auth password when `SUPABASE_ADMIN_PASSWORD` is unset |
| `ADMIN_PASSWORD_HASH` | preferred over `ADMIN_PASSWORD` for login. `scrypt:<salt hex>:<key hex>` |
| `SUPABASE_ADMIN_PASSWORD` | optional. That Supabase Auth user's password when it differs from the site password |
| `ADMIN_SESSION_SECRET` | HMAC secret for the session and lockout cookies. 16+ random characters |
| `SENTRY_DSN` | optional. When set, the same scrubbed error report also goes to Sentry. Never commit it |

Generate a password hash with Node's built-in scrypt (the same defaults the login check uses):

```bash
node -e "const c=require('crypto');const p=process.argv[1];const s=c.randomBytes(16);const k=c.scryptSync(p,s,32);console.log('scrypt:'+s.toString('hex')+':'+k.toString('hex'))" 'your-password'
```

`netlify.toml` sets `SECRETS_SCAN_OMIT_KEYS = "ADMIN_EMAIL"` because that address is intentionally public on the Contact page; the scan itself stays on.

## Database policies

Row-level security is enabled on `bcmg_data`, `capernaum_data` and `honeyford_data`. The anon key can read; a write with that key alone changes zero rows. A save therefore requires the signed session *and* a signed-in Supabase Auth user. Each table needs a `SELECT` and an `UPDATE` policy for the `authenticated` role, comparing `auth.jwt()->>'email'` to the administrator's address:

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
```

Repeat for `capernaum_data` and `honeyford_data`, substituting the address stored in `ADMIN_EMAIL`. To check what is in place:

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

If the Supabase sign-in fails, the log says `Supabase admin sign-in failed` and the page shows "Error Updating Record. Please try again." A write that changes zero rows is a different failure: the page says nothing was saved.

## Error logs

Function errors are one JSON line in the Netlify function log: `level`, `function`, `path` (no query string), `message`, `stack`, `timestamp`. The line never includes the request body, cookies, or the values of `SUPABASE_API_KEY`, `ADMIN_PASSWORD`, `SUPABASE_ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD_HASH` or `SENTRY_DSN`. A visitor sees the friendly error page ("Something went wrong", `noindex`, no canonical, `Cache-Control: no-store`) or the page that handler already uses for that failure.

To read them: Netlify dashboard → **Logs** (or **Functions**, pick the function), filter for `"level":"error"`.

Browser errors (`window.onerror`, unhandled rejections) are posted by the footer script to `logClientError`, at most five per page view. The endpoint keeps the stack and page path, drops every other field, and stops answering an address that posts more than 20 reports in 10 minutes; `robots.txt` disallows it.

Sentry is optional: set `SENTRY_DSN` in the site's environment variables and redeploy. There is no package to install and the DSN is never written into the repository.

Submit `https://memorafind.com/sitemap.xml` in [Google Search Console](https://search.google.com/search-console) → Sitemaps. The sitemap uses the same public read; no extra variable is needed.

## Known issues in detail

**Burial location is missing from the source data.** Of the 2,428 records, 2,426 have neither a section nor a lot. The other two are both at Bamberg County Memory Gardens and store an invented section: `BAMBERG` on record 1000365 and `MARKER` on record 1001420. No row stores a lot. The saved Bamberg County Memory Gardens listing has two "Plot info" lines (`bamberg county memory`, `Marker only`); Capernaum and Honey Ford have none, so re-scraping would not produce a location. The page omits the row for those values, and for a stored section of `2011` (no CSV row stores it). A record with no usable section or lot shows no row at all — it never says "Section and lot not recorded" and never guesses. Until plots are collected by hand, or come from the cemeteries or the county library, the site cannot say where a grave is.

**Administrator saves are confirmed working in production**, and the offline harness (`node tools/verify-review-fixes.js`) exercises them against a stub database: login, lockout, logout, a rejected anonymous save, the field allowlist, a missing cemetery, a Supabase sign-in that supplies the token, a sign-in that fails, the sitemap, the record page's description and structured data, the correction link and its prefilled email, and the error log. It runs 336 checks and reports 0 failed. Live database checks are outside that harness.

**Photos, biographies and family connections are not built.** Nothing of the kind is stored or read, and none of it appears in the interface. It needs new structures in Supabase and a decision on who moderates a stranger's contribution before it can start. The nearest thing today is the free-text `notes` and the `moved_from` / `moved_to` relocation fields, shown under "More details" when a record carries one.
