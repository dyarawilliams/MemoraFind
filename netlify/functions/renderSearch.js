const { createClient } = require('@supabase/supabase-js');
const ejs = require("ejs");
const path = require("path");

// Connect to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

exports.handler = async function (event, context) {
    // Extract cemetery from path
    const cemetery = event.path.split('/').pop();
    console.log("Cemetery parameter:", cemetery);
        
    // Validate cemetery
    const validCemeteries = ["bcmg", "capernaum", "honeyford"];
    if (!validCemeteries.includes(cemetery)) {
        return {
            statusCode: 404,
            body: 'Cemetery not found',
            headers: { "Content-Type": "text/plain" }
        };
    }
        
    // Get cemetery title
    const title = getCemeteryTitle(cemetery);
    
    // Check if any search parameters were provided
    const hasSearchParams = event.queryStringParameters && Object.keys(event.queryStringParameters).length > 0;
    
     // Initialize data as empty array
    let data = [];

    // Only query the database if search parameters are present
    if (hasSearchParams) {
        const { lastName, firstName, maidenName, birthYear, deathYear } = event.queryStringParameters;

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

        // Add optional elements to the query
        if (lastName) query = query.ilike('last_name', `%${lastName}%`);
        if (firstName) query = query.ilike('first_name', `%${firstName}%`);
        if (maidenName) query = query.ilike('maiden_name', `%${maidenName}%`);
        if (birthYear) query = query.eq('birth_year', birthYear);
        if (deathYear) query = query.eq('death_year', deathYear);

        try {
            let { data: queryData, error } = await query;
            if (error) throw error;
            data = queryData;
        } catch (error) {
            console.error("Error querying database:", error);
            return {
                statusCode: 500,
                body: "Internal Server Error",
            };
        }
    }

    try {
        // Render the search template
        const templatePath = path.resolve(__dirname, "../../public/views/search.ejs");
        const html = await ejs.renderFile(templatePath, {
            cemetery,
            title,
            records: data,
            hasSearchParams,
            searched: hasSearchParams
        });

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
};

function getCemeteryTitle(cemetery) {
    const titles = {
        bcmg: "Bamberg County Memory Gardens",
        capernaum: "Capernaum Cemetery",
        honeyford: "Honey Ford Cemetery",
    };
    return titles[cemetery] || "Unknown Cemetery";
}
