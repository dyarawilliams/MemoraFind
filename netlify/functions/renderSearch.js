const { createClient } = require('@supabase/supabase-js');
const ejs = require("ejs");
const path = require("path");

// Connect to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

// A birth or death year has to look like a year (four digits — the search
// form's own fields accept 1700-2050) before it is put in a query. Validating
// it is not a query change: it only decides whether the query is built.
const YEAR_PATTERN = /^\d{4}$/;

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
    
    // Check if any search parameters were provided
    const hasSearchParams = event.queryStringParameters && Object.keys(event.queryStringParameters).length > 0;

     // Initialize data as empty array
    let data = [];

    const { lastName, firstName, maidenName, birthYear, deathYear } = event.queryStringParameters || {};

    // A birth or death year has to be a year before it is sent to the database.
    // The birth_year / death_year columns are numeric, so a hand-typed "abc"
    // made the database reject the query and the visitor was told "the record
    // database is temporarily unavailable" — the wrong cause, and advice
    // ("try again shortly") that could never help. The query is not built at
    // all in that case; the page says what is wrong with the input instead.
    // Nothing about a valid query changes: the same columns, the same filters
    // and the same limit as before.
    const invalidYears = [];
    if (birthYear && !YEAR_PATTERN.test(birthYear)) invalidYears.push("birth year");
    if (deathYear && !YEAR_PATTERN.test(deathYear)) invalidYears.push("death year");
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
    let query = supabase
        .from(`${cemetery}_data_formatted_2`)
        .select(`
            memorial_id,
            prefix,
            last_name,
            first_name,
            middle_name,
            maiden_name,
            suffix,
            birth_date,
            death_date,
            age_sane,
            section,
            lot,
            is_vet,
            notes,
            moved_from,
            moved_to
        `)
        .order('last_name', { ascending: true });

    if (hasSearchParams) {
        // Add optional elements to the query
        if (lastName) query = query.ilike('last_name', `%${lastName}%`);
        if (firstName) query = query.ilike('first_name', `%${firstName}%`);
        if (maidenName) query = query.ilike('maiden_name', `%${maidenName}%`);
        if (birthYear) query = query.eq('birth_year', birthYear);
        if (deathYear) query = query.eq('death_year', deathYear);
    } else {
        // With no filters the cemetery can still be browsed, so ask for its
        // first 50 records in last-name order instead of querying nothing.
        query = query.range(0, 49);
    }

    try {
        let { data: queryData, error } = await query;
        if (error) throw error;
        data = queryData;
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
