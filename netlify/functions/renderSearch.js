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

// Connect to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

// A birth or death year has to look like a year (four digits — the search
// form's own fields accept 1700-2050) before it is put in a query. Validating
// it is not a query change: it only decides whether the query is built.
const YEAR_PATTERN = /^\d{4}$/;

// How many records any single request may render. The browse path has always
// asked for its first 50; the filtered path asked for everything, and Supabase's
// own 1000-row cap then got printed as if it were a total. The cap now belongs
// to the query on both paths (see RESULT_LIMIT below), so 1000 rows can no
// longer be sent, let alone counted.
const RESULT_LIMIT = 50;

exports.handler = async function (event, context) {
    // Extract cemetery from path
    const cemetery = event.path.split('/').pop();
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
    // &maidenName=&birthYear=&deathYear=` and `?x=1` carry nothing to filter
    // on, and they used to take the filtered path: a query with no filters and
    // no limit, whose truncated result set the page then reported as "1000
    // records found" (~3.4 MB). Only one of the five fields having a value
    // makes this request a search; otherwise it is a browse, exactly like
    // /search/<cemetery>. Values are trimmed so a field holding only spaces
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

    // A birth or death year has to be a year before it is sent to the database.
    // The birth_year / death_year columns are numeric, so a hand-typed "abc"
    // made the database reject the query and the visitor was told "the record
    // database is temporarily unavailable" — the wrong cause, and advice
    // ("try again shortly") that could never help. The query is not built at
    // all in that case; the page says what is wrong with the input instead.
    // Nothing about a valid query changes: the same columns and the same
    // filters as before.
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
    // table name comes from the cemetery slug through the same derivation the
    // save path and the record page use (baseRecord.js), so the card can only
    // ever show the row a save writes.
    //
    // The columns are read as '*', the same way the record page reads its single
    // record: the template renders the fields it knows and ignores the rest, and
    // a column the base table does not have simply stays absent (the card then
    // renders exactly as it does for a record with nothing recorded — never
    // "undefined", never a stray 0). An explicit list would have to name every
    // column of a table this function cannot see, and a wrong name would turn a
    // working search into "the database is unavailable".
    let query = supabase
        .from(baseTableForCemetery(cemetery))
        // count: 'exact' makes PostgREST report how many rows match the whole
        // filter in the same request (the Content-Range total), independently of
        // how many rows are sent back. That is what lets the page state a real
        // total while the body itself carries at most RESULT_LIMIT records.
        .select('*', { count: 'exact' })
        .order('last_name', { ascending: true });

    // Add optional elements to the query. A field with no value adds no filter:
    // with all five blank the query is the browse query, not an unbounded one.
    if (filterLastName) query = query.ilike('last_name', `%${filterLastName}%`);
    if (filterFirstName) query = query.ilike('first_name', `%${filterFirstName}%`);
    if (filterMaidenName) query = query.ilike('maiden_name', `%${filterMaidenName}%`);
    if (filterBirthYear) query = query.eq('birth_year', filterBirthYear);
    if (filterDeathYear) query = query.eq('death_year', filterDeathYear);

    // The row cap is part of the query, on every path — browse and filtered
    // alike. The template can only render what the database sent, so a 1000-row
    // response is impossible rather than merely unlikely.
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
        console.error("Error querying database:", error);
        console.error("Supabase error details:", {
            code: error && error.code,
            message: error && error.message,
            details: error && error.details,
            hint: error && error.hint,
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
        console.error("Error rendering search.ejs:", error);
        return {
            statusCode: 500,
            body: "Internal Server Error",
        };
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
        console.error("Error rendering cemetery-not-found.ejs:", error);
        return {
            statusCode: 404,
            headers: { "Content-Type": "text/plain" },
            body: "Cemetery not found",
        };
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
