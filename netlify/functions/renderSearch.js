const ejs = require("ejs");
const path = require("path");

exports.handler = async function (event, context) {
    try {
        // Extract cemetery from path parameters
        const cemetery = event.path.split('/').pop();
        console.log("Path:", event.path);
        console.log("Cemetery parameter:", cemetery);

        // Validate cemetery parameter
        const validCemeteries = ["bcmg", "capernaum", "honeyford"];
        if (!cemetery || !validCemeteries.includes(cemetery)) {
            return {
                statusCode: 404,
                body: "Cemetery not found",
                headers: { "Content-Type": "text/plain" }
            };
        }

        // Render the search template
        const templatePath = path.resolve(
            __dirname,
            "../../public/views/search.ejs"
        );
        const html = await ejs.renderFile(templatePath, {
            cemetery,
            title: getCemeteryTitle(cemetery),
            records: null // Add this to prevent undefined records error
        });

        return {
            statusCode: 200,
            headers: { "Content-Type": "text/html" },
            body: html,
        };
    } catch (error) {
        console.error("Error rendering search page:", error.message);
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
    return titles[cemetery];
}
