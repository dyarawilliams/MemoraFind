#!/usr/bin/env node
/*
 * Build public/sitemap.xml from the record IDs in the scraper's CSV files.
 *
 * Why this exists: a cemetery search page no longer lists records until a
 * visitor types a query (owner's instruction, 2026-10-23), so the only route a
 * search engine has to a person's grave page is this sitemap. A hand-written
 * file with 2,428 lines in it would be wrong the first time a record is added
 * or removed, and nobody would notice; generating it from the same CSV files
 * the database was loaded from means the sitemap cannot disagree with the
 * records we hold.
 *
 * The sitemap lists, in this order:
 *   1. https://memorafind.com/                    (the landing page)
 *   2. https://memorafind.com/search/bcmg         (the three cemetery searches)
 *   3. https://memorafind.com/search/capernaum
 *   4. https://memorafind.com/search/honeyford
 *   5. https://memorafind.com/grave/<id>          (every record, sorted numerically)
 *
 * This is a development tool, not part of deployment: nothing runs it on
 * Netlify, it adds no dependency (only Node's own fs and path), and it is not
 * referenced by netlify.toml. Run it after the CSVs change and commit the
 * regenerated file:
 *
 *   node tools/build-sitemap.js           # write public/sitemap.xml
 *   node tools/build-sitemap.js --check   # exit 1 if public/sitemap.xml is stale
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRAPER_DIR = path.join(ROOT, 'python-scraper');
const OUTPUT = path.join(ROOT, 'public', 'sitemap.xml');

const BASE_URL = 'https://memorafind.com';
const LASTMOD = '2026-10-23';

// The records we hold, one CSV per cemetery. Order here is the order the
// search URLs appear in the sitemap.
const SOURCES = [
    { cemetery: 'bcmg', file: 'parsed_names_bcmg.csv', expected: 1815 },
    { cemetery: 'capernaum', file: 'parsed_names_capernaum.csv', expected: 346 },
    { cemetery: 'honeyford', file: 'parsed_names_honeyford.csv', expected: 267 }
];

const EXPECTED_TOTAL = 2428;
const FIRST_ID = 1000001;
const LAST_ID = 1002428;

/*
 * Split one CSV line into fields, honouring double-quoted values. The memorial
 * ID is the first column and is always a plain number today, but reading the
 * file properly means a quoted field somewhere else cannot shift the columns
 * and silently change which number we treat as the ID.
 */
function splitCsvLine(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            fields.push(field);
            field = '';
        } else {
            field += ch;
        }
    }
    fields.push(field);
    return fields;
}

/* Read the memorial_id column of one CSV file. The first line is the header. */
function readMemorialIds(fileName) {
    const fullPath = path.join(SCRAPER_DIR, fileName);
    if (!fs.existsSync(fullPath)) {
        throw new Error('Missing record source: ' + path.relative(ROOT, fullPath));
    }
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    const rows = lines.filter((line) => line.trim() !== '');
    if (rows.length === 0) {
        throw new Error('Record source is empty: ' + path.relative(ROOT, fullPath));
    }

    const header = splitCsvLine(rows[0]).map((name) => name.trim().replace(/^\uFEFF/, ''));
    const idColumn = header.indexOf('memorial_id');
    if (idColumn === -1) {
        throw new Error('No memorial_id column in ' + path.relative(ROOT, fullPath) + ' (header: ' + header.join(', ') + ')');
    }

    return rows.slice(1).map((line) => {
        const value = (splitCsvLine(line)[idColumn] || '').trim();
        return value;
    });
}

/*
 * Collect and check the IDs. This is deliberately strict: a truncated or
 * half-written CSV would otherwise produce a shorter sitemap that still looks
 * well-formed, and pages would quietly drop out of the index. Failing here
 * means a person decides, not a silent shrink.
 */
function collectIds() {
    const ids = [];
    const perSource = [];

    for (const source of SOURCES) {
        const fileIds = readMemorialIds(source.file);
        perSource.push({ file: source.file, count: fileIds.length, expected: source.expected });
        for (const id of fileIds) {
            if (!/^\d+$/.test(id)) {
                throw new Error('Non-numeric memorial_id "' + id + '" in ' + source.file);
            }
            ids.push(id);
        }
    }

    const unique = new Set(ids);
    if (unique.size !== ids.length) {
        const seen = new Set();
        const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
        throw new Error('Duplicate memorial_id(s) across the CSV files: ' + Array.from(new Set(duplicates)).join(', '));
    }

    if (unique.size !== EXPECTED_TOTAL) {
        throw new Error(
            'Expected ' + EXPECTED_TOTAL + ' unique memorial IDs but found ' + unique.size +
            ' (' + perSource.map((s) => s.file + ': ' + s.count).join(', ') + '). ' +
            'If the record set really changed, update EXPECTED_TOTAL/FIRST_ID/LAST_ID in this tool on purpose.'
        );
    }

    for (const source of perSource) {
        if (source.count !== source.expected) {
            throw new Error(
                'Expected ' + source.expected + ' records in ' + source.file + ' but found ' + source.count + '. ' +
                'If the record set really changed, update this tool on purpose.'
            );
        }
    }

    const sorted = Array.from(unique).map(Number).sort((a, b) => a - b);
    if (sorted[0] !== FIRST_ID || sorted[sorted.length - 1] !== LAST_ID) {
        throw new Error(
            'Expected IDs ' + FIRST_ID + '–' + LAST_ID + ' but the range is ' + sorted[0] + '–' + sorted[sorted.length - 1] + '.'
        );
    }
    for (let id = FIRST_ID; id <= LAST_ID; id++) {
        if (!unique.has(String(id))) {
            throw new Error('Memorial ID ' + id + ' is missing from the CSV files, so the range is not contiguous.');
        }
    }

    return { ids: sorted, perSource };
}

/* Escape the five characters that cannot appear literally in XML text. */
function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function urlBlock(loc) {
    return '  <url>\n    <loc>' + escapeXml(loc) + '</loc>\n    <lastmod>' + LASTMOD + '</lastmod>\n  </url>\n';
}

function buildSitemap(ids) {
    const urls = [BASE_URL + '/'];
    for (const source of SOURCES) {
        urls.push(BASE_URL + '/search/' + source.cemetery);
    }
    for (const id of ids) {
        urls.push(BASE_URL + '/grave/' + id);
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const loc of urls) {
        xml += urlBlock(loc);
    }
    xml += '</urlset>\n';

    return { xml, urlCount: urls.length };
}

function main() {
    const checkOnly = process.argv.includes('--check');
    const { ids } = collectIds();
    const { xml, urlCount } = buildSitemap(ids);

    if (checkOnly) {
        const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : null;
        if (current === xml) {
            console.log('public/sitemap.xml is up to date (' + urlCount + ' URLs, ' + Buffer.byteLength(xml) + ' bytes)');
            return;
        }
        if (current === null) {
            console.error('public/sitemap.xml is MISSING — run: node tools/build-sitemap.js');
        } else {
            const currentUrls = (current.match(/<url>/g) || []).length;
            const reason = currentUrls === urlCount
                ? 'it holds ' + currentUrls + ' URLs, the same number the records need, but the contents differ'
                : 'it holds ' + currentUrls + ' URLs, the records need ' + urlCount;
            console.error('public/sitemap.xml is STALE — ' + reason + '. Run: node tools/build-sitemap.js');
        }
        process.exit(1);
    }

    fs.writeFileSync(OUTPUT, xml, 'utf8');
    console.log(
        'Wrote public/sitemap.xml (' + urlCount + ' URLs: 1 home, ' + SOURCES.length + ' cemetery searches, ' +
        ids.length + ' grave pages; ' + Buffer.byteLength(xml) + ' bytes)'
    );
}

try {
    main();
} catch (error) {
    console.error('Could not build public/sitemap.xml:', error.message);
    process.exit(1);
}
