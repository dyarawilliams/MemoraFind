const { createClient } = require('@supabase/supabase-js');
const ejs = require("ejs");
const path = require("path");
// The table a cemetery's data really lives in, and the way the base table's
// three date columns become the one string the display rules parse. Both live in
// baseRecord.js so that a result card and the person's own record page
// (renderGrave.js) read the same row of the same table and compose a date the
// same way — a card showed "09/2008" where the page showed "09/12/2008" before
// this, because the card read the *_data_formatted_2 view and the page read the
// base table.
const { baseTableForCemetery, displayRecord } = require('./baseRecord');
const { logError, friendlyError } = require('./errorReport');

// Connect to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

// A birth or death year has to look like a year (four digits — the search
// form's own fields accept 1700-2050) before it is put in a query. Validating
// it is not a query change: it only decides whether the query is built.
const YEAR_PATTERN = /^\d{4}$/;

// How many records any single request may render. It belongs to the query
// itself (see the .range() call below), so a 1000-row response — Supabase's own
// cap, once printed as if it were a total — can no longer be sent, let alone
// counted. A page with no usable filter renders no records at all, so there is
// nothing to cap there: it never reaches the database.
const RESULT_LIMIT = 50;

//PostgreSQL ILIKE treats "%" and "_" as wildcards and "\" as the escape
//character. A name the visitor typed has to match as characters, so those
//three are escaped before the same leading and trailing "%" that make the
//filter a substring search. The supabase client sends the pattern as the
//value of `ilike.<pattern>`; PostgREST binds that value as a parameter and
//does not strip the backslashes. (A typed "*" is a separate PostgREST alias
//for "%" on ilike, rewritten even when a backslash precedes it, so it cannot
//be made literal through this operator.)
function literalIlikePattern(text) {
    return '%' + String(text).replace(/[\\%_]/g, '\\$&') + '%';
}

exports.handler = async function (event, context) {
    // Extract cemetery from path. The slug is the last segment that carries
    // text, so a trailing slash resolves to the same cemetery: /search/bcmg/
    // used to be read as an empty slug and answered "Cemetery not found",
    // because the empty string after the final "/" was taken as the slug. A
    // hand-typed or pasted address ending in "/" is common, and the record page
    // (/grave/<id>/, renderGrave.js) has always accepted one, so the two now
    // behave the same way. Only the slug changes here: the slug that comes out
    // of a normal /search/<cemetery> address is the same string as before, and
    // every query below is built exactly as it was.
    const pathSegments = String(event.path || "")
        .split("/")
        .filter((segment) => segment !== "");
    const cemetery = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : "";
    // console.log("Cemetery parameter:", cemetery);
        
    // Validate cemetery
    const validCemeteries = ["bcmg", "capernaum", "honeyford"];
    if (!validCemeteries.includes(cemetery)) {
        // A slug that is not a cemetery gets the site's own not-found page —
        // the same header, footer and type as every other page, a link back to
        // the search and the three real cemeteries — instead of an unstyled
        // line of text. The status code stays an honest 404.
        return renderCemeteryNotFoundPage(cemetery);
    }
        
    // Get cemetery title
    const title = getCemeteryTitle(cemetery);
    
     // Initialize data as empty array
    let data = [];

    const { lastName, firstName, maidenName, birthYear, deathYear } = event.queryStringParameters || {};

    // A query string is not the same thing as a search. `?lastName=&firstName=
    // &maidenName=&birthYear=&deathYear=`, `?foo=bar` and a bare `?` carry
    // nothing to filter on. Only one of the five fields having a value makes
    // this request a search. Values are trimmed so a field holding only spaces
    // counts as blank too, and an unknown key is simply ignored.
    const asText = (value) => (typeof value === "string" ? value.trim() : "");
    const filterLastName = asText(lastName);
    const filterFirstName = asText(firstName);
    const filterMaidenName = asText(maidenName);
    const filterBirthYear = asText(birthYear);
    const filterDeathYear = asText(deathYear);

    const hasSearchParams = Boolean(
        filterLastName || filterFirstName || filterMaidenName || filterBirthYear || filterDeathYear
    );

    // No usable filter: the page lists nothing at all. Until this change an
    // empty query listed the cemetery's first 50 records — a list nobody asked
    // for, and one that read like a complete answer to a question that had not
    // been asked. The page now shows its own heading, the search form it
    // already had, and one line saying what to type; the database is not
    // queried, because there is nothing to fetch, so nothing here can fail or
    // be slow. A request that does carry a filter is still capped at
    // RESULT_LIMIT rows and still asks for an exact count.
    if (!hasSearchParams) {
        return renderSearchPage({
            cemetery,
            title,
            records: [],
            hasSearchParams,
            searched: false,
            // Tells the template this is the "nothing typed yet" page, which is
            // not the same thing as a search that matched nothing — the latter
            // is a real result and says "0 records found".
            awaitingSearch: true,
            databaseUnavailable: false
        });
    }

    // A birth or death year has to be a year before it is sent to the database.
    // The birth_year / death_year columns are numeric, so a hand-typed "abc"
    // made the database reject the query and the visitor was told "the record
    // database is temporarily unavailable" — the wrong cause, and advice
    // ("try again shortly") that could never help. The query is not built at
    // all in that case; the page says what is wrong with the input instead.
    // A year that is four digits is still an exact match on that column.
    const invalidYears = [];
    if (filterBirthYear && !YEAR_PATTERN.test(filterBirthYear)) invalidYears.push("birth year");
    if (filterDeathYear && !YEAR_PATTERN.test(filterDeathYear)) invalidYears.push("death year");
    if (invalidYears.length > 0) {
        return renderSearchPage({
            cemetery,
            title,
            records: [],
            hasSearchParams,
            searched: hasSearchParams,
            invalidYears,
            databaseUnavailable: false
        });
    }

    // Build the query
    //
    // The BASE table behind the cemetery's formatted view is read, not the view
    // itself: the view drops the day of the month from a death date, so a card
    // rendered from it showed "09/2008" for the person whose own page — reading
    // the base table since the record-page change — showed "09/12/2008". The
    // table name comes from the cemetery slug through baseRecord.js, the same
    // map the record page uses, so the card reads the table that map names.
    //
    // Every column is read. Naming columns (the list added for the unused-column
    // review) made PostgREST reject the query, and the page then says the
    // database is unavailable: one listed name is not a column of the base
    // table. The formatted views carry age_sane, notes, moved_from and
    // moved_to, and the scraper CSVs that filled these tables do not, so those
    // four are the names that can fail a list. Which of them is actually
    // absent is not known here. A '*' read leaves a missing column off the
    // row, and the templates already treat that as nothing recorded. Limiting
    // the select to the columns the pages show has to wait until the live
    // schema is known; until then '*' also returns columns the page does not
    // show.
    let query = supabase
        .from(baseTableForCemetery(cemetery))
        // count: 'exact' makes PostgREST report how many rows match the whole
        // filter in the same request (the Content-Range total), independently of
        // how many rows are sent back. That is what lets the page state a real
        // total while the body itself carries at most RESULT_LIMIT records.
        .select('*', { count: 'exact' })
        .order('last_name', { ascending: true });

    // Add optional elements to the query. A field with no value adds no filter.
    // A request with no value in any of the five has already returned above, so
    // this is always a search. Name filters stay case-insensitive substrings;
    // "%" and "_" and "\" in the typed text match themselves (literalIlikePattern).
    if (filterLastName) query = query.ilike('last_name', literalIlikePattern(filterLastName));
    if (filterFirstName) query = query.ilike('first_name', literalIlikePattern(filterFirstName));
    if (filterMaidenName) query = query.ilike('maiden_name', literalIlikePattern(filterMaidenName));
    if (filterBirthYear) query = query.eq('birth_year', filterBirthYear);
    if (filterDeathYear) query = query.eq('death_year', filterDeathYear);

    // The row cap is part of the query. The template can only render what the
    // database sent, so a 1000-row response is impossible rather than merely
    // unlikely.
    query = query.range(0, RESULT_LIMIT - 1);

    // totalMatches is the exact number of matching records, or null if the
    // database did not report one; null means the page says how many records it
    // is showing instead of inventing a total.
    let totalMatches = null;

    try {
        const { data: queryData, count: queryCount, error } = await query;
        if (error) throw error;
        // The base table keeps a date as three columns (month name, day, year)
        // while the display rules read the single "MM/DD/YYYY" string with zeros
        // for the parts that were never recorded, so each row is composed the
        // same way the record page composes it (baseRecord.displayRecord). This
        // is the only change to the rows themselves: the values are the ones the
        // table holds, and a part that is not recorded stays a placeholder the
        // display rules drop.
        data = (queryData || []).map(displayRecord);
        totalMatches = (typeof queryCount === "number") ? queryCount : null;
    } catch (error) {
        // The database could not be read. Say so plainly rather than showing an
        // empty result list, which would read as "no such person"; the real
        // Supabase error stays in the function log, never in the response body.
        await logError({
            functionName: "renderSearch",
            event: event,
            error: error,
            message: "Error querying database"
        });

        return renderSearchPage({
            cemetery,
            title,
            records: [],
            hasSearchParams,
            searched: hasSearchParams,
            databaseUnavailable: true
        });
    }

    return renderSearchPage({
        cemetery,
        title,
        records: data,
        hasSearchParams,
        searched: hasSearchParams,
        // What the page needs to describe a truncated result honestly: the
        // number of rows it is allowed to show, and the exact number of
        // matching records (null when the database did not report one).
        resultLimit: RESULT_LIMIT,
        totalMatches,
        databaseUnavailable: false
    });
};

// Render the search page. Called with the same locals as before, plus
// databaseUnavailable so the page can tell "nothing found" from "could not look".
async function renderSearchPage(locals) {
    try {
        const templatePath = path.resolve(__dirname, "../../public/views/search.ejs");
        const html = await ejs.renderFile(templatePath, locals);

        return {
            statusCode: 200,
            headers: { "Content-Type": "text/html" },
            body: html,
        };
    } catch (error) {
        return friendlyError({
            functionName: "renderSearch",
            error: error,
            message: "Error rendering search.ejs"
        });
    }
}

// Render the "no such cemetery" page in the site's own design. It is a real
// page (header, footer, the three cemeteries, a way back to the search) rather
// than the bare line of text this path used to answer with, and the response
// keeps the honest 404 status. If the template cannot be rendered the plain
// line is still better than a stack trace.
async function renderCemeteryNotFoundPage(requestedSlug) {
    try {
        const templatePath = path.resolve(__dirname, "../../public/views/cemetery-not-found.ejs");
        const html = await ejs.renderFile(templatePath, { requestedSlug });

        return {
            statusCode: 404,
            headers: { "Content-Type": "text/html" },
            body: html,
        };
    } catch (error) {
        return friendlyError({
            functionName: "renderSearch",
            error: error,
            statusCode: 404,
            message: "Error rendering cemetery-not-found.ejs"
        });
    }
}

function getCemeteryTitle(cemetery) {
    const titles = {
        bcmg: "Bamberg County Memory Gardens",
        capernaum: "Capernaum Cemetery",
        honeyford: "Honey Ford Cemetery",
    };
    return titles[cemetery] || "Unknown Cemetery";
}
