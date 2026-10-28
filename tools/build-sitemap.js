#!/usr/bin/env node
/*
 * Check the memorial IDs in the scraper's CSV files.
 *
 * The live sitemap is no longer a file in public/. Netlify serves
 * /sitemap.xml from netlify/functions/sitemap.js, which reads memorial_id
 * from Supabase on each request (see the redirect in netlify.toml). A
 * committed public/sitemap.xml would be wrong the first time a record changed
 * in the database, and force = true on that redirect is what keeps a leftover
 * file from being what crawlers receive.
 *
 * This tool still refuses a truncated CSV. The IDs the database was loaded
 * from are 1000001–1002428, 2,428 of them, one count per cemetery file. Run
 * it after the CSVs change. It does not write public/sitemap.xml:
 *
 *   node tools/build-sitemap.js
 *   node tools/build-sitemap.js --check
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRAPER_DIR = path.join(ROOT, 'python-scraper');

// The records the database was loaded from, one CSV per cemetery.
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
 * half-written CSV would otherwise look complete. Failing here means a person
 * decides, not a silent shrink. The live sitemap is built from Supabase, not
 * from these files.
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

function main() {
    const { ids, perSource } = collectIds();
    const staleFile = path.join(ROOT, 'public', 'sitemap.xml');
    if (fs.existsSync(staleFile)) {
        console.error('public/sitemap.xml is present. The live sitemap is the Netlify function, and this file would be unused. Delete it.');
        process.exit(1);
    }
    console.log(
        'Scraper CSVs hold ' + ids.length + ' memorial IDs (' +
        perSource.map(function (source) { return source.file + ': ' + source.count; }).join(', ') +
        '). /sitemap.xml is generated by netlify/functions/sitemap.js. This tool does not write a file.'
    );
}

try {
    main();
} catch (error) {
    console.error('Could not check the scraper record IDs:', error.message);
    process.exit(1);
}
