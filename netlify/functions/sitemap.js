/*
 * /sitemap.xml — the public addresses, built from the records Supabase holds.
 *
 * netlify.toml redirects /sitemap.xml here (force = true, so a leftover static
 * file cannot shadow it). The anon key already used by search and the record
 * page is the only credential: each cemetery's base table is read for
 * memorial_id alone, the same column findCemetery.js already selects, paged
 * under PostgREST's 1000-row cap. Nothing is written.
 *
 * A failure is a 503 with no record list. Publishing a short sitemap would
 * drop grave pages out of the index without anyone noticing.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { CEMETERY_TABLES } = require('./baseRecord');
const { logError } = require('./errorReport');

const BASE_URL = 'https://memorafind.com';
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

const PUBLIC_LOCS = [
  BASE_URL + '/',
  BASE_URL + '/contact',
  BASE_URL + '/search/bcmg',
  BASE_URL + '/search/capernaum',
  BASE_URL + '/search/honeyford'
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemap(graveIds) {
  const locs = PUBLIC_LOCS.concat(graveIds.map(function (id) {
    return BASE_URL + '/grave/' + id;
  }));
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (let i = 0; i < locs.length; i += 1) {
    xml += '  <url>\n    <loc>' + escapeXml(locs[i]) + '</loc>\n  </url>\n';
  }
  xml += '</urlset>\n';
  return xml;
}

async function memorialIds(supabase, table) {
  const ids = [];
  let previousFirst = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from(table)
      .select('memorial_id')
      .order('memorial_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;

    // A page that starts where the previous page started is the same page
    // again. Stop rather than loop. Ids inside one page are kept even when
    // they arrive out of order; the caller sorts and dedupes.
    const firstRaw = data[0] && data[0].memorial_id;
    const firstText = firstRaw === null || firstRaw === undefined ? '' : String(firstRaw);
    if (previousFirst !== null && firstText === previousFirst) break;
    previousFirst = firstText;

    for (let i = 0; i < data.length; i += 1) {
      const raw = data[i] && data[i].memorial_id;
      if (raw === null || raw === undefined) continue;
      const text = String(raw).trim();
      if (!/^\d+$/.test(text)) continue;
      ids.push(text);
    }
    if (data.length < PAGE_SIZE) break;
  }
  return ids;
}

function unavailable() {
  return {
    statusCode: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: 'The sitemap could not be generated just now. Please try again shortly.\n'
  };
}

exports.handler = async function (event) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_API_KEY) {
    await logError({
      functionName: 'sitemap',
      event: event,
      message: 'Sitemap is not configured. SUPABASE_URL and SUPABASE_API_KEY are required.'
    });
    return unavailable();
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);
    const codes = Object.keys(CEMETERY_TABLES);
    const seen = new Set();
    const graveIds = [];
    for (let i = 0; i < codes.length; i += 1) {
      const table = CEMETERY_TABLES[codes[i]].table;
      const ids = await memorialIds(supabase, table);
      for (let j = 0; j < ids.length; j += 1) {
        if (seen.has(ids[j])) continue;
        seen.add(ids[j]);
        graveIds.push(ids[j]);
      }
    }
    graveIds.sort(function (a, b) {
      return Number(a) - Number(b);
    });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400'
      },
      body: buildSitemap(graveIds)
    };
  } catch (error) {
    await logError({
      functionName: 'sitemap',
      event: event,
      error: error,
      message: 'Could not build the sitemap'
    });
    return unavailable();
  }
};

exports.escapeXml = escapeXml;
exports.PUBLIC_LOCS = PUBLIC_LOCS;
