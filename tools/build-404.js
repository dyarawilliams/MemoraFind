#!/usr/bin/env node
/*
 * Render public/views/not-found.ejs into public/404.html.
 *
 * Why this exists: the site has no build step (netlify.toml publishes public/
 * exactly as it is committed), so a page served straight off the CDN has to be
 * a static file. Netlify serves public/404.html, with a 404 status, for any
 * request that matches no redirect rule and no file — that is the page a
 * visitor reaches by mistyping a link. Writing it by hand would mean copying
 * the header, nav and footer out of public/views/partials/ and letting the
 * copy drift the first time the header changes; rendering the real template
 * through the real partials means the 404 page cannot disagree with the rest
 * of the site.
 *
 * This is a development tool, not part of deployment: nothing runs it on
 * Netlify, it adds no dependency (ejs is already a dependency of the site) and
 * it is not referenced by netlify.toml. Run it after editing not-found.ejs,
 * header.ejs or footer.ejs, and commit the regenerated file:
 *
 *   node tools/build-404.js           # write public/404.html
 *   node tools/build-404.js --check   # exit 1 if public/404.html is stale
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'public', 'views', 'not-found.ejs');
const OUTPUT = path.join(ROOT, 'public', '404.html');

async function render() {
    return ejs.renderFile(TEMPLATE, {}, { filename: TEMPLATE });
}

async function main() {
    const html = await render();
    const checkOnly = process.argv.includes('--check');
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : null;

    if (checkOnly) {
        if (current === html) {
            console.log('public/404.html is up to date (' + Buffer.byteLength(html) + ' bytes)');
            return;
        }
        console.error('public/404.html is STALE — run: node tools/build-404.js');
        process.exit(1);
    }

    fs.writeFileSync(OUTPUT, html, 'utf8');
    console.log('Wrote public/404.html (' + Buffer.byteLength(html) + ' bytes) from public/views/not-found.ejs');
}

main().catch((error) => {
    console.error('Could not render public/views/not-found.ejs:', error);
    process.exit(1);
});
