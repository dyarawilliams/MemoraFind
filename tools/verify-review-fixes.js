/*
 * Checks the review fixes without a database and without a test runner.
 *
 *   node tools/verify-review-fixes.js
 *
 * The real handlers and the real EJS templates run against a stubbed Supabase
 * client. The script exits 0 when every check passes, and 1 otherwise.
 *
 * Reads, and the save's returning select, use select('*'). A named column
 * list cannot be checked here against the live base tables, and a missing
 * name rejects the whole query.
 *
 * Admin sign-in is exercised here too: login success and failure, lockout,
 * logout, a rejected anonymous save, the field allowlist, and a missing
 * cemetery. The save's Supabase Auth sign-in is stubbed as well: a successful
 * sign-in attaches an access token to the update, and a failed sign-in is an
 * error. The sitemap, the record page's description and structured data, the
 * grave page's correction link, and the error log are checked here too.
 * Sentry's HTTP send is replaced for the
 * duration of that check. No request leaves this process. The address is
 * TEST_ADMIN_EMAIL, not a real Supabase user. This script sets the admin
 * environment variables itself.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');
const querystring = require('querystring');

const ADMIN_PASSWORD = 'correct-horse-battery';
const SUPABASE_ADMIN_PASSWORD = 'supabase-admin-secret';
const TEST_ADMIN_EMAIL = 'admin@example.test';
const STUB_ACCESS_TOKEN = 'stub-access-token';

const failures = [];
let passed = 0;

function check(name, ok) {
  if (ok) {
    passed += 1;
    return;
  }
  failures.push(name);
}

function same(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok);
  if (!ok) {
    failures.push('    actual: ' + JSON.stringify(actual));
    failures.push('    expected: ' + JSON.stringify(expected));
  }
}

// PostgreSQL ILIKE, the way PostgREST binds a simple ilike value: "\" escapes
// the next character, "%" is any sequence, "_" is one character, and the match
// is case-insensitive. "*" is NOT rewritten here; PostgREST does that before
// the value is bound, and only for ilike.
function ilikeMatches(pattern, value) {
  let body = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      if (i >= pattern.length) break;
      body += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    if (ch === '%') {
      body += '[\\s\\S]*';
      continue;
    }
    if (ch === '_') {
      body += '[\\s\\S]';
      continue;
    }
    body += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + body + '$', 'i').test(String(value));
}

const calls = [];
const signIns = [];
const refreshes = [];
let signInShouldFail = false;
let refreshShouldFail = false;
let sessionExpiresInSeconds = 3600;
let next = { rows: [], count: null, error: null, view: null };

function expectedStubPassword() {
  const dedicated = process.env.SUPABASE_ADMIN_PASSWORD;
  if (typeof dedicated === 'string' && dedicated.length > 0) return dedicated;
  return process.env.ADMIN_PASSWORD || '';
}

function respond(state) {
  if (state.update) {
    if (next.updateError) {
      const updateError = next.updateError;
      if (next.updateErrorOnce) next.updateError = null;
      return { data: null, error: updateError, status: updateError.status || 400 };
    }
    if (Array.isArray(next.updatedRows)) return { data: next.updatedRows, error: null, status: 200 };
    return { data: next.rows, error: null, status: 200 };
  }
  if (String(state.table).endsWith('_formatted_2')) {
    if (next.view && state.table === next.view) {
      const idFilter = state.filters.find(function (filter) {
        return filter.op === 'eq' && filter.column === 'memorial_id';
      });
      return { data: [{ memorial_id: idFilter ? idFilter.value : null }], error: null };
    }
    return { data: [], error: null };
  }
  if (next.error) return { data: null, count: null, error: next.error, status: 500 };
  return { data: next.rows, count: next.count, error: null, status: 200 };
}

function makeBuilder(state) {
  const builder = {
    select: function (cols, options) {
      state.select = cols;
      state.selectOptions = options || null;
      return builder;
    },
    order: function (column, options) {
      state.order = { column: column, options: options || null };
      return builder;
    },
    ilike: function (column, pattern) {
      state.filters.push({ op: 'ilike', column: column, pattern: pattern });
      return builder;
    },
    eq: function (column, value) {
      state.filters.push({ op: 'eq', column: column, value: value });
      return builder;
    },
    range: function (from, to) {
      state.range = [from, to];
      return builder;
    },
    limit: function (n) {
      state.limit = n;
      return builder;
    },
    update: function (payload) {
      state.update = JSON.parse(JSON.stringify(payload));
      return builder;
    },
    single: function () {
      state.single = true;
      return builder;
    },
    then: function (resolve, reject) {
      const snapshot = JSON.parse(JSON.stringify(state));
      calls.push(snapshot);
      let result = respond(state);
      if (state.single) {
        const rows = result.data;
        result = {
          data: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
          error: result.error,
          status: result.status
        };
      }
      return Promise.resolve(result).then(resolve, reject);
    }
  };
  return builder;
}

function createClient(url, key, options) {
  let accessToken = null;
  const authOptions = options && options.auth ? options.auth : null;
  return {
    auth: {
      signInWithPassword: function (credentials) {
        const email = credentials && credentials.email;
        const password = credentials && credentials.password;
        signIns.push({
          email: email,
          url: url,
          persistSession: authOptions ? authOptions.persistSession : undefined,
          autoRefreshToken: authOptions ? authOptions.autoRefreshToken : undefined,
          usedSupabaseAdminPassword: typeof process.env.SUPABASE_ADMIN_PASSWORD === 'string' && process.env.SUPABASE_ADMIN_PASSWORD.length > 0 && password === process.env.SUPABASE_ADMIN_PASSWORD,
          usedSiteAdminPassword: password === process.env.ADMIN_PASSWORD
        });
        if (signInShouldFail || email !== String(process.env.ADMIN_EMAIL || '') || password !== expectedStubPassword()) {
          return Promise.resolve({
            data: { user: null, session: null },
            error: { message: 'Invalid login credentials' }
          });
        }
        accessToken = STUB_ACCESS_TOKEN;
        const expiresIn = sessionExpiresInSeconds;
        return Promise.resolve({
          data: {
            user: { id: 'stub-user', email: email },
            session: {
              access_token: accessToken,
              refresh_token: 'stub-refresh-token',
              expires_in: expiresIn,
              expires_at: Math.floor(Date.now() / 1000) + expiresIn,
              token_type: 'bearer'
            }
          },
          error: null
        });
      },
      refreshSession: function () {
        refreshes.push({ clientHadToken: Boolean(accessToken) });
        if (refreshShouldFail || !accessToken) {
          return Promise.resolve({
            data: { user: null, session: null },
            error: { message: 'refresh failed' }
          });
        }
        accessToken = STUB_ACCESS_TOKEN;
        return Promise.resolve({
          data: {
            user: { id: 'stub-user', email: process.env.ADMIN_EMAIL },
            session: {
              access_token: accessToken,
              refresh_token: 'stub-refresh-token',
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              token_type: 'bearer'
            }
          },
          error: null
        });
      }
    },
    from: function (table) {
      return makeBuilder({
        table: table,
        select: null,
        selectOptions: null,
        filters: [],
        order: null,
        range: null,
        limit: null,
        update: null,
        single: false,
        accessToken: accessToken
      });
    }
  };
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return { createClient: createClient };
  }
  return originalLoad.apply(this, arguments);
};

process.env.SUPABASE_URL = 'http://127.0.0.1';
process.env.SUPABASE_API_KEY = 'test-key';
process.env.ADMIN_EMAIL = TEST_ADMIN_EMAIL;
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
process.env.SUPABASE_ADMIN_PASSWORD = SUPABASE_ADMIN_PASSWORD;
process.env.ADMIN_SESSION_SECRET = 'test-session-secret-0123456789';
delete process.env.ADMIN_PASSWORD_HASH;
delete process.env.SENTRY_DSN;

const baseRecord = require('../netlify/functions/baseRecord');
const renderSearch = require('../netlify/functions/renderSearch');
const renderGrave = require('../netlify/functions/renderGrave');
const getUpdateRecord = require('../netlify/functions/getUpdateRecord');
const login = require('../netlify/functions/login');
const logout = require('../netlify/functions/logout');
const updatePage = require('../netlify/functions/updatePage');
const updateRecord = require('../netlify/functions/updateRecord');
const adminSession = require('../netlify/functions/adminSession');
const renderIndex = require('../netlify/functions/renderIndex');
const renderContact = require('../netlify/functions/renderContact');
const sitemap = require('../netlify/functions/sitemap');
const logClientError = require('../netlify/functions/logClientError');
const errorReport = require('../netlify/functions/errorReport');

function reset(partial) {
  calls.length = 0;
  next = Object.assign({ rows: [], count: null, error: null, view: null }, partial || {});
}

function dataCalls() {
  return calls.filter(function (call) {
    return !String(call.table).endsWith('_formatted_2');
  });
}

function patternFor(text) {
  return '%' + String(text).replace(/[\\%_]/g, '\\$&') + '%';
}

function ilike(call, column) {
  return call.filters.find(function (filter) {
    return filter.op === 'ilike' && filter.column === column;
  });
}

const FULL_ROW = {
  memorial_id: 1000004,
  prefix: 'Mrs',
  first_name: 'Wilhelmina',
  middle_name: 'J',
  maiden_name: 'Doe',
  last_name: 'Abel',
  suffix: 'Jr',
  is_vet: 'Y',
  birth_month: 'Jan',
  birth_day: 28,
  birth_year: 1907,
  death_month: 'Sep',
  death_day: 12,
  death_year: 2008,
  age_sane: '101',
  section: 'Garden',
  lot: '4',
  notes: 'Stone reads 100% of the name',
  moved_from: 'Plot A_1',
  moved_to: 'Plot B\\2'
};

function cookieHeaders(response) {
  const found = [];
  const multi = response.multiValueHeaders || {};
  const multiCookies = multi['Set-Cookie'] || multi['set-cookie'];
  if (Array.isArray(multiCookies)) found.push.apply(found, multiCookies);
  const headers = response.headers || {};
  const single = headers['Set-Cookie'] || headers['set-cookie'];
  if (Array.isArray(single)) found.push.apply(found, single);
  else if (typeof single === 'string') found.push(single);
  return found;
}

function sessionPair(response) {
  const all = cookieHeaders(response);
  for (let i = 0; i < all.length; i += 1) {
    if (all[i].indexOf('mf_session=') === 0 && all[i].indexOf('Max-Age=0') === -1) {
      return all[i].split(';')[0];
    }
  }
  return '';
}

function hasSessionCookie(response) {
  return sessionPair(response).indexOf('mf_session=') === 0;
}

function cookieFlags(value) {
  return Boolean(value)
    && value.indexOf('HttpOnly') !== -1
    && value.indexOf('Secure') !== -1
    && value.indexOf('SameSite=Strict') !== -1
    && value.indexOf('Path=/') !== -1;
}

function metaContent(html, attribute, name) {
  const pattern = new RegExp('<meta\\s+' + attribute + '="' + name + '"\\s+content="([^"]*)"', 'i');
  const match = String(html || '').match(pattern);
  return match ? match[1] : '';
}

function canonicalHref(html) {
  const match = String(html || '').match(/<link rel="canonical" href="([^"]*)"/);
  return match ? match[1] : '';
}

function titleText(html) {
  const match = String(html || '').match(/<title>([^<]*)<\/title>/);
  return match ? match[1] : '';
}

function jsonLd(html) {
  const match = String(html || '').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function htmlUnescape(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// The href as it was printed (entities still escaped) and as a URL the browser
// would open. encodeURIComponent leaves "'" alone; EJS then writes it as &#39;.
function correctionLink(html) {
  const match = String(html || '').match(/<a class="grave-note__report" href="([^"]*)" target="_blank" rel="noopener noreferrer"/);
  if (!match) return null;
  const raw = match[1];
  let url = null;
  try {
    url = new URL(htmlUnescape(raw));
  } catch (error) {
    url = null;
  }
  return { raw: raw, url: url };
}

function hrefAmpersandsAreEntities(raw) {
  return !/&(?!amp;|#39;|lt;|gt;|quot;)/.test(String(raw));
}

function formFieldIds(yaml) {
  const ids = [];
  const pattern = /^ {4}id: ([A-Za-z0-9_-]+)\s*$/gm;
  let match = pattern.exec(yaml);
  while (match) {
    ids.push(match[1]);
    match = pattern.exec(yaml);
  }
  return ids;
}

function sitemapLocs(xml) {
  const locs = [];
  const pattern = /<loc>([^<]*)<\/loc>/g;
  let match = pattern.exec(xml);
  while (match) {
    locs.push(match[1]);
    match = pattern.exec(xml);
  }
  return locs;
}

async function captureLogs(run) {
  const lines = [];
  const original = console.error;
  console.error = function () {
    const parts = [];
    for (let i = 0; i < arguments.length; i += 1) {
      const part = arguments[i];
      parts.push(typeof part === 'string' ? part : JSON.stringify(part));
    }
    lines.push(parts.join(' '));
    return original.apply(console, arguments);
  };
  try {
    return { result: await run(), lines: lines };
  } finally {
    console.error = original;
  }
}

function responseCarriesSecret(response) {
  const text = String(response && response.body || '')
    + '\n' + cookieHeaders(response || {}).join('\n')
    + '\n' + JSON.stringify((response && response.headers) || {});
  return text.indexOf(STUB_ACCESS_TOKEN) !== -1
    || text.indexOf('stub-refresh-token') !== -1
    || text.indexOf(SUPABASE_ADMIN_PASSWORD) !== -1
    || text.indexOf(ADMIN_PASSWORD) !== -1
    || text.indexOf(TEST_ADMIN_EMAIL) !== -1;
}

function loginEvent(password, ip) {
  return {
    httpMethod: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': ip
    },
    body: querystring.stringify({ password: password })
  };
}

function formBody(overrides) {
  const fields = {
    memorial_id: String(FULL_ROW.memorial_id),
    first_name: FULL_ROW.first_name,
    middle_name: FULL_ROW.middle_name,
    maiden_name: FULL_ROW.maiden_name,
    last_name: FULL_ROW.last_name,
    suffix: FULL_ROW.suffix,
    is_vet: FULL_ROW.is_vet,
    birth_year: String(FULL_ROW.birth_year),
    birth_month: FULL_ROW.birth_month,
    birth_day: String(FULL_ROW.birth_day),
    death_year: String(FULL_ROW.death_year),
    death_month: FULL_ROW.death_month,
    death_day: String(FULL_ROW.death_day),
    section: FULL_ROW.section,
    lot: String(FULL_ROW.lot)
  };
  return querystring.stringify(Object.assign(fields, overrides || {}));
}

async function main() {
  // --- 1. Wildcard escaping ----------------------------------------------
  const samples = ['Wil', '100%', 'a_b', 'a\\b', '100%_\\', "O'Brien", 'Van Buren'];
  check('a plain name stays a substring pattern', patternFor('Wil') === '%Wil%');
  samples.forEach(function (text) {
    const pattern = patternFor(text);
    check('pattern contains the typed text as literals: ' + JSON.stringify(text), ilikeMatches(pattern, 'xx' + text + 'yy'));
    check('pattern does not treat % as "anything": ' + JSON.stringify(text), text.indexOf('%') === -1 || !ilikeMatches(pattern, 'xx100yy'));
    check('pattern does not treat _ as one character: ' + JSON.stringify(text), text.indexOf('_') === -1 || !ilikeMatches(pattern, 'xxabyy') && !ilikeMatches(pattern, 'xxaXbyy'));
    check('a backslash is not eaten: ' + JSON.stringify(text), text.indexOf('\\') === -1 || ilikeMatches(pattern, 'xx' + text + 'yy'));
  });

  check('old unescaped pattern for 100% would match 1000', ilikeMatches('%100%%', '1000'));
  check('escaped pattern for 100% does not match 1000', !ilikeMatches(patternFor('100%'), '1000'));
  check('escaped pattern for 100% matches a real percent sign', ilikeMatches(patternFor('100%'), 'score 100% today'));
  check('old unescaped pattern for a_b matches axb', ilikeMatches('%a_b%', 'axb'));
  check('escaped pattern for a_b does not match axb', !ilikeMatches(patternFor('a_b'), 'axb'));
  check('escaped pattern for a_b matches a_b', ilikeMatches(patternFor('a_b'), 'a_b'));
  check('Wil still matches Williams and Wilkes', ilikeMatches(patternFor('Wil'), 'Williams') && ilikeMatches(patternFor('wil'), 'Wilkes'));
  check('Wil does not match Walker', !ilikeMatches(patternFor('Wil'), 'Walker'));

  // The client puts the pattern in a query parameter. URLSearchParams encodes
  // and decodes it without dropping a backslash or a percent sign.
  const roundTrip = new URLSearchParams();
  roundTrip.append('last_name', 'ilike.' + patternFor('100%_\\'));
  check(
    'the pattern survives the query-string encoding the supabase client uses',
    roundTrip.get('last_name') === 'ilike.' + patternFor('100%_\\')
  );

  reset({
    rows: [Object.assign({}, FULL_ROW)],
    count: 65
  });
  const search = await renderSearch.handler({
    path: '/search/bcmg/',
    queryStringParameters: {
      lastName: '100%',
      firstName: 'a_b',
      maidenName: 'a\\b',
      birthYear: '1907',
      deathYear: '2008'
    }
  }, {});
  check('a search with wildcards still returns HTML 200', search.statusCode === 200);
  const searchCall = dataCalls()[0];
  check('one data query was built', dataCalls().length === 1);
  same('search reads bcmg_data', searchCall && searchCall.table, 'bcmg_data');
  same('last name pattern is literal', ilike(searchCall, 'last_name') && ilike(searchCall, 'last_name').pattern, patternFor('100%'));
  same('first name pattern is literal', ilike(searchCall, 'first_name') && ilike(searchCall, 'first_name').pattern, patternFor('a_b'));
  same('maiden name pattern is literal', ilike(searchCall, 'maiden_name') && ilike(searchCall, 'maiden_name').pattern, patternFor('a\\b'));
  same('birth year stays an exact match', searchCall.filters.find(function (f) { return f.column === 'birth_year'; }), { op: 'eq', column: 'birth_year', value: '1907' });
  same('death year stays an exact match', searchCall.filters.find(function (f) { return f.column === 'death_year'; }), { op: 'eq', column: 'death_year', value: '2008' });
  same('the 50-row cap is still the query range', searchCall.range, [0, 49]);
  same('the count is still exact', searchCall.selectOptions, { count: 'exact' });
  same('results are still ordered by last name', searchCall.order, { column: 'last_name', options: { ascending: true } });
  check('the page states the exact total past the cap', search.body.indexOf('65 records found') !== -1 && search.body.indexOf('showing the first 1') !== -1);
  check('the card shows the composed death day', search.body.indexOf('09/12/2008') !== -1);
  check('the card shows the composed birth date', search.body.indexOf('01/28/1907') !== -1);
  check('the card shows notes, moved_from and moved_to', search.body.indexOf('Stone reads 100% of the name') !== -1 && search.body.indexOf('Plot A_1') !== -1 && search.body.indexOf('Plot B\\2') !== -1);
  check('the card shows the burial location that was stored', search.body.indexOf('Section Garden') !== -1 && search.body.indexOf('Lot 4') !== -1);
  check('the card shows the stored age', search.body.indexOf('>101<') !== -1);
  check('the card writes given names, maiden name, surname, then suffix',
    search.body.indexOf('<span class="record__given">Wilhelmina J</span> <span class="record__maiden">Doe</span> <span class="record__surname">Abel</span>, <span class="record__given">Jr</span>') !== -1 &&
    search.body.indexOf('née') === -1 &&
    search.body.indexOf('<p class="record__maiden">') === -1);

  reset();
  const idle = await renderSearch.handler({ path: '/search/capernaum', queryStringParameters: { lastName: '   ' } }, {});
  check('a blank search does not query', calls.length === 0 && idle.statusCode === 200 && idle.body.indexOf('Type a last name') !== -1);

  reset();
  const badYear = await renderSearch.handler({ path: '/search/honeyford', queryStringParameters: { birthYear: 'abc' } }, {});
  check('a non-year does not query', calls.length === 0 && badYear.body.indexOf('birth year') !== -1);

  reset({ rows: [], count: 0 });
  const none = await renderSearch.handler({ path: '/search/bcmg', queryStringParameters: { lastName: 'Zz%' } }, {});
  check('a search that matches nothing says 0 and still escapes the pattern', none.body.indexOf('0 records found') !== -1 && ilike(dataCalls()[0], 'last_name').pattern === patternFor('Zz%'));

  // --- 2. Reads cannot fail on a missing column --------------------------
  same('search selects every column', searchCall.select, '*');
  check('search keeps the exact count alongside *', searchCall.selectOptions && searchCall.selectOptions.count === 'exact');

  const viewOnly = ['age_sane', 'notes', 'moved_from', 'moved_to'];
  const csvHeader = fs.readFileSync(path.resolve(__dirname, '../python-scraper/parsed_names_bcmg.csv'), 'utf8').split(/\r?\n/)[0].split(',');
  viewOnly.forEach(function (name) {
    check(name + ' is not a column the scraper CSV loads into the base table', csvHeader.indexOf(name) === -1);
  });
  check(
    'the legacy search handler is gone',
    !fs.existsSync(path.resolve(__dirname, '../netlify/functions/search.js'))
  );
  const searchSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/renderSearch.js'), 'utf8');
  const graveSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/renderGrave.js'), 'utf8');
  check('search no longer names a column list', searchSource.indexOf('BASE_RECORD_COLUMNS') === -1 && searchSource.indexOf(".select('*', { count: 'exact' })") !== -1);
  check('grave no longer names a column list', graveSource.indexOf('BASE_RECORD_COLUMNS') === -1 && graveSource.indexOf(".select('*')") !== -1);

  const composedRow = baseRecord.displayRecord({
    birth_month: 'Sep',
    birth_day: 12,
    birth_year: 2008,
    death_month: null,
    death_day: 0,
    death_year: ''
  });
  same('displayRecord composes a date and leaves a missing date empty', [composedRow.birth_date, composedRow.death_date], ['09/12/2008', '']);

  const storedAge = baseRecord.displayRecord({ birth_year: 1900, death_year: 2000, age_sane: '40' });
  check('a stored age_sane wins over the year difference', storedAge.age_sane === '40');
  const computedAge = baseRecord.displayRecord({ birth_year: 1907, death_year: 2008, age_sane: '' });
  check('a missing age_sane is the year difference', computedAge.age_sane === '101');

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'capernaum_data_formatted_2' });
  const grave = await renderGrave.handler({ path: '/grave/1000004' }, {});
  const graveCall = dataCalls()[0];
  check('grave page is 200', grave.statusCode === 200);
  same('grave reads the base table for the view findCemetery resolved', graveCall && graveCall.table, 'capernaum_data');
  same('grave selects every column', graveCall && graveCall.select, '*');
  same('grave still reads one row by memorial id', [graveCall.limit, graveCall.filters], [1, [{ op: 'eq', column: 'memorial_id', value: '1000004' }]]);
  check('grave shows dates, age, notes, relocation and location',
    grave.body.indexOf('01/28/1907') !== -1 &&
    grave.body.indexOf('09/12/2008') !== -1 &&
    grave.body.indexOf('>101<') !== -1 &&
    grave.body.indexOf('Stone reads 100% of the name') !== -1 &&
    grave.body.indexOf('Plot A_1') !== -1 &&
    grave.body.indexOf('Plot B\\2') !== -1 &&
    grave.body.indexOf('Section Garden') !== -1 &&
    grave.body.indexOf('Lot 4') !== -1 &&
    grave.body.indexOf('Veteran') !== -1 &&
    grave.body.indexOf('<span class="record__maiden">Doe</span>') !== -1 &&
    grave.body.indexOf('Wilhelmina J Doe Abel, Jr') !== -1 &&
    grave.body.indexOf('née') === -1);
  check('grave does not print a zero placeholder', grave.body.indexOf('0/0/0') === -1 && grave.body.indexOf('00/0/') === -1);

  const sameCard = search.body.indexOf('09/12/2008') !== -1 && grave.body.indexOf('09/12/2008') !== -1;
  check('the card and the grave page show the same death date', sameCard);

  reset({
    rows: [{
      memorial_id: 1000955,
      last_name: 'Nobody',
      first_name: 'N',
      birth_month: null,
      birth_day: 0,
      birth_year: 0,
      death_month: '',
      death_day: null,
      death_year: null,
      age_sane: 0,
      section: 'MARKER',
      lot: null,
      notes: '   ',
      moved_from: null,
      moved_to: ''
    }],
    view: 'honeyford_data_formatted_2'
  });
  const emptyGrave = await renderGrave.handler({ path: '/grave/1000955/' }, {});
  check('an unrecorded date says Not recorded', emptyGrave.statusCode === 200 && emptyGrave.body.indexOf('Not recorded') !== -1);
  check('no Age row and no invented section when nothing usable was stored', emptyGrave.body.indexOf('<dt>Age</dt>') === -1 && emptyGrave.body.indexOf('MARKER') === -1 && emptyGrave.body.indexOf('More details') === -1);

  reset({ rows: [], count: 2, view: 'bcmg_data_formatted_2' });
  const missing = await renderGrave.handler({ path: '/grave/999999999' }, {});
  check('a missing record is still 404 and does not invent a row', missing.statusCode === 404);

  // --- 3. Shared table name ----------------------------------------------
  const legacySplit = function (view) {
    return String(view).split('_', 2).join('_');
  };
  Object.keys(baseRecord.CEMETERY_TABLES).forEach(function (code) {
    const entry = baseRecord.CEMETERY_TABLES[code];
    same('map names ' + code + ' the same table the old split names', baseRecord.baseTableFor(entry.view), legacySplit(entry.view));
    same('slug ' + code + ' names that table', baseRecord.baseTableForCemetery(code), entry.table);
    check(code + ' has no extra underscore, which is why the old split worked', code.indexOf('_') === -1);
  });
  same('an extra underscore is no longer read as the table name', baseRecord.baseTableFor('honey_ford_data_formatted_2'), null);
  check('the old split would have dropped _data on that name', legacySplit('honey_ford_data_formatted_2') === 'honey_ford');
  same('an unknown slug is not given a guessed table', baseRecord.baseTableForCemetery('not-a-cemetery'), null);

  // The write path names its table with baseTableFor (baseRecord.js). The old
  // split of the view name is gone: a null cemetery used to throw before the
  // null check, and an unknown view must not be turned into a guessed table.
  const updateSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/updateRecord.js'), 'utf8');
  check('the save path names the table with baseTableFor', updateSource.indexOf('baseTableFor') !== -1);
  check('the save path no longer splits the cemetery view', updateSource.indexOf('.split(') === -1);
  check('the save path selects every column', updateSource.indexOf(".select('*')") !== -1);
  check('the save path does not name a column in select', updateSource.indexOf("select('memorial_id'") === -1 && updateSource.indexOf('select("memorial_id"') === -1);
  check('the save signs in with signInWithPassword', updateSource.indexOf('signInWithPassword') !== -1);
  check('the save client sets persistSession false', updateSource.indexOf('persistSession: false') !== -1);
  check('the save reads SUPABASE_ADMIN_PASSWORD', updateSource.indexOf('SUPABASE_ADMIN_PASSWORD') !== -1);

  const views = {
    bcmg_data_formatted_2: 'bcmg_data',
    capernaum_data_formatted_2: 'capernaum_data',
    honeyford_data_formatted_2: 'honeyford_data'
  };
  adminSession.resetAuthStateForTests();
  reset();
  const setupLogin = await login.handler(loginEvent(ADMIN_PASSWORD, '198.51.100.10'), {});
  const adminCookie = sessionPair(setupLogin);
  const setupCookie = cookieHeaders(setupLogin).find(function (value) {
    return value.indexOf('mf_session=') === 0;
  });
  check('login with the env password returns the update page', setupLogin.statusCode === 200 && setupLogin.body.indexOf('Update a grave record') !== -1 && setupLogin.body.indexOf('Admin login') === -1);
  check('login does not query the database', calls.length === 0);
  check('login sets a signed session cookie', adminCookie.indexOf('mf_session=') === 0 && adminCookie.indexOf('.') !== -1);
  check('the session cookie is HttpOnly, Secure, SameSite=Strict, and expires', Boolean(setupCookie) && cookieFlags(setupCookie) && setupCookie.indexOf('Max-Age=600') !== -1);
  const viewNames = Object.keys(views);
  for (let i = 0; i < viewNames.length; i += 1) {
    const view = viewNames[i];
    reset({
      rows: [Object.assign({}, FULL_ROW, { death_day: 12 })],
      view: view
    });
    const page = await getUpdateRecord.handler({
      headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
      queryStringParameters: { memorial_id: '1000004' }
    }, {});
    const read = dataCalls()[0];
    same('edit form for ' + view + ' reads ' + views[view], read && read.table, views[view]);
    check('edit form does not read the view', read && String(read.table).indexOf('formatted') === -1);
    check('edit form still receives the stored death day', page.statusCode === 200 && page.body.indexOf('value="12"') !== -1);
    check('edit form read does not use a supabase access token', read && !read.accessToken);
    check('edit form does not sign in to Supabase', signIns.length === 0);
    const lookedUp = calls.filter(function (call) { return String(call.table).endsWith('_formatted_2'); }).map(function (call) { return call.table; });
    check('findCemetery was consulted for ' + view, lookedUp.indexOf(view) !== -1);
  }

  const lookupSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/getUpdateRecord.js'), 'utf8');
  check('getUpdateRecord no longer has its own split', lookupSource.indexOf("split('_', 2)") === -1);
  check('the edit lookup does not sign in to Supabase', lookupSource.indexOf('signInWithPassword') === -1);

  // --- 4. Admin session and the save path --------------------------------
  const loginSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/login.js'), 'utf8');
  const authSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/adminSession.js'), 'utf8');
  check('login no longer hard-codes the admin email', loginSource.indexOf(TEST_ADMIN_EMAIL) === -1);
  check('login no longer signs in through Supabase Auth', loginSource.indexOf('signInWithPassword') === -1 && loginSource.indexOf('@supabase/supabase-js') === -1);
  check('password comparison is constant-time', authSource.indexOf('timingSafeEqual') !== -1);
  check('the save does not forward the cookie as a bearer token', updateSource.indexOf('Authorization') === -1);

  reset();
  const wrong = await login.handler(loginEvent('not-the-password', '198.51.100.19'), {});
  const failCookie = cookieHeaders(wrong).find(function (value) { return value.indexOf('mf_fail=') === 0; });
  check('a wrong password is rejected', wrong.statusCode === 401 && wrong.body.indexOf('Login failed') !== -1);
  check('a wrong password does not open a session', !hasSessionCookie(wrong) && calls.length === 0);
  check('a wrong password sets a signed lockout cookie', Boolean(failCookie) && cookieFlags(failCookie) && failCookie.indexOf('.') !== -1 && failCookie.indexOf('Max-Age=0') === -1);

  const probedIp = '198.51.100.18';
  for (let n = 0; n < adminSession.FAILURE_LIMIT; n += 1) {
    const probed = await login.handler({ httpMethod: 'GET', headers: { 'x-forwarded-for': probedIp } }, {});
    check('a non-POST login does not start a session', probed.statusCode === 405 && !hasSessionCookie(probed));
  }
  const afterProbe = await login.handler(loginEvent(ADMIN_PASSWORD, probedIp), {});
  check('probing the login URL does not lock the client out', afterProbe.statusCode === 200 && hasSessionCookie(afterProbe));

  const belowLimit = '198.51.100.25';
  for (let n = 0; n < adminSession.FAILURE_LIMIT - 1; n += 1) {
    const attempt = await login.handler(loginEvent('nope', belowLimit), {});
    check('failure ' + (n + 1) + ' below the limit is 401', attempt.statusCode === 401 && !hasSessionCookie(attempt));
  }
  const recovered = await login.handler(loginEvent(ADMIN_PASSWORD, belowLimit), {});
  check('a correct password below the limit still signs in', recovered.statusCode === 200 && hasSessionCookie(recovered));

  const lockedIp = '198.51.100.20';
  for (let n = 0; n < adminSession.FAILURE_LIMIT - 1; n += 1) {
    const attempt = await login.handler(loginEvent('nope', lockedIp), {});
    check('lockout setup failure ' + (n + 1) + ' stays 401', attempt.statusCode === 401 && !hasSessionCookie(attempt));
  }
  const tripping = await login.handler(loginEvent('nope', lockedIp), {});
  check('the failure that reaches the limit is locked out', tripping.statusCode === 429 && tripping.body.indexOf('Too many attempts') !== -1 && !hasSessionCookie(tripping));
  const duringLock = await login.handler(loginEvent(ADMIN_PASSWORD, lockedIp), {});
  check('the correct password is rejected during lockout', duringLock.statusCode === 429 && !hasSessionCookie(duringLock));
  const otherClient = await login.handler(loginEvent(ADMIN_PASSWORD, '198.51.100.21'), {});
  check('a different client is not locked out', otherClient.statusCode === 200 && hasSessionCookie(otherClient));

  const salt = crypto.randomBytes(16);
  const hashKey = crypto.scryptSync('hash-secret-password', salt, 32);
  process.env.ADMIN_PASSWORD_HASH = 'scrypt:' + salt.toString('hex') + ':' + hashKey.toString('hex');
  delete process.env.ADMIN_PASSWORD;
  const hashed = await login.handler(loginEvent('hash-secret-password', '198.51.100.40'), {});
  const hashedWrong = await login.handler(loginEvent(ADMIN_PASSWORD, '198.51.100.41'), {});
  check('a scrypt hash signs in', hashed.statusCode === 200 && hasSessionCookie(hashed));
  check('the plaintext env password is not accepted once a hash is set', hashedWrong.statusCode === 401 && !hasSessionCookie(hashedWrong));
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD_HASH;

  const openGate = await updatePage.handler({ headers: {} }, {});
  check('update page without a session is the login page', openGate.statusCode === 200 && openGate.body.indexOf('Admin login') !== -1 && openGate.body.indexOf('Find a record') === -1);
  check('a fresh visit does not say the session timed out', openGate.body.indexOf('Session has timed out') === -1);
  check('the login form has a username control before the password', openGate.body.indexOf('autocomplete="username"') !== -1 && openGate.body.indexOf('autocomplete="username"') < openGate.body.indexOf('autocomplete="current-password"'));
  check('the username control is not a posted field', /<input[^>]*autocomplete="username"[^>]*>/.test(openGate.body) && !/\bname="username"/.test(openGate.body));
  const signedGate = await updatePage.handler({ headers: { cookie: adminCookie } }, {});
  check('update page with a session is the edit gate', signedGate.statusCode === 200 && signedGate.body.indexOf('Find a record') !== -1);
  const forgedCookie = adminCookie.slice(0, -1) + (adminCookie.slice(-1) === 'a' ? 'b' : 'a');
  const forgedGate = await updatePage.handler({ headers: { cookie: forgedCookie } }, {});
  check('a forged session cookie is rejected', forgedGate.statusCode === 200 && forgedGate.body.indexOf('Admin login') !== -1);
  check('a forged session is not described as timed out', forgedGate.body.indexOf('Session has timed out') === -1);
  const expiredBody = Buffer.from(JSON.stringify({
    v: 1,
    kind: 'session',
    sub: TEST_ADMIN_EMAIL,
    iat: Math.floor(Date.now() / 1000) - 1200,
    exp: Math.floor(Date.now() / 1000) - 60,
    jti: 'expired-session-id-0001'
  }), 'utf8').toString('base64url');
  const expiredSignature = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(expiredBody).digest('base64url');
  const expiredGate = await updatePage.handler({
    headers: { cookie: 'mf_session=' + expiredBody + '.' + expiredSignature }
  }, {});
  check('an expired session shows the login page and says it timed out', expiredGate.statusCode === 200 && expiredGate.body.indexOf('Admin login') !== -1 && expiredGate.body.indexOf('Session has timed out. Please log in again.') !== -1 && expiredGate.body.indexOf('Find a record') === -1);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const anonymousLookup = await getUpdateRecord.handler({
    headers: {},
    queryStringParameters: { memorial_id: '1000004' }
  }, {});
  check('an anonymous lookup is rejected', anonymousLookup.statusCode === 401 && anonymousLookup.body.indexOf('Admin login') !== -1 && anonymousLookup.body.indexOf('Session has timed out') === -1);
  check('an anonymous lookup does not read the database', calls.length === 0);
  check('an anonymous lookup does not render the record', anonymousLookup.body.indexOf('Wilhelmina') === -1);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const legacyLookup = await getUpdateRecord.handler({
    headers: { cookie: 'token=supabase-access-token' },
    queryStringParameters: { memorial_id: '1000004' }
  }, {});
  check('a legacy token cookie is not a session', legacyLookup.statusCode === 401 && calls.length === 0 && legacyLookup.body.indexOf('Wilhelmina') === -1);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const anonymousSave = await updateRecord.handler({
    httpMethod: 'POST',
    headers: {},
    body: formBody({ last_name: 'Abell', notes: 'pwned' })
  }, {});
  check('an anonymous save is rejected', anonymousSave.statusCode === 401 && anonymousSave.body.indexOf('Admin login') !== -1 && anonymousSave.body.indexOf('updated successfully') === -1);
  check('an anonymous save does not write', calls.length === 0);
  check('an anonymous save does not sign in to Supabase', signIns.length === 0);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const forgedSave = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: forgedCookie },
    body: formBody({ last_name: 'Abell' })
  }, {});
  check('a forged session cannot save', forgedSave.statusCode === 401 && calls.length === 0);

  const saveViews = Object.keys(views);
  for (let s = 0; s < saveViews.length; s += 1) {
    const view = saveViews[s];
    reset({ rows: [Object.assign({}, FULL_ROW)], view: view });
    const saved = await updateRecord.handler({
      httpMethod: 'POST',
      headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
      body: formBody({
        last_name: 'Abell',
        notes: 'pwned',
        prefix: 'Dr',
        role: 'admin',
        moved_from: 'somewhere else'
      })
    }, {});
    const writes = calls.filter(function (call) { return call.update; });
    const read = dataCalls().filter(function (call) { return !call.update; })[0];
    check('save for ' + view + ' succeeds', saved.statusCode === 200 && saved.body.indexOf('Record 1000004 has been updated successfully.') !== -1);
    same('save for ' + view + ' writes ' + views[view], writes[0] && writes[0].table, views[view]);
    same('save for ' + view + ' writes only the changed allowlisted field', writes[0] && writes[0].update, { last_name: 'Abell' });
    same('save for ' + view + ' reads with select *', read && read.select, '*');
    same('save for ' + view + ' returns rows with select *', writes[0] && writes[0].select, '*');
    check('save for ' + view + ' is a single write', writes.length === 1);
    check('save for ' + view + ' updates with the supabase access token', writes[0] && writes[0].accessToken === STUB_ACCESS_TOKEN);
    check('save for ' + view + ' reads without a supabase access token', read && !read.accessToken);
    check('save for ' + view + ' does not return the supabase token', responseCarriesSecret(saved) === false);
  }

  check('the save signs in once and reuses that session', signIns.length === 1);
  check('the save signs in as TEST_ADMIN_EMAIL', signIns[0] && signIns[0].email === TEST_ADMIN_EMAIL);
  check('the save signs in with SUPABASE_ADMIN_PASSWORD', signIns[0] && signIns[0].usedSupabaseAdminPassword === true && signIns[0].usedSiteAdminPassword === false);
  check('the save client does not persist the session', signIns[0] && signIns[0].persistSession === false && signIns[0].autoRefreshToken === false);
  check('the save does not sign in against a real address', signIns[0] && signIns[0].url === 'http://127.0.0.1');

  const signInsBeforeUnchanged = signIns.length;
  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const unchanged = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie },
    body: formBody()
  }, {});
  check('an unchanged form does not write', unchanged.statusCode === 200 && unchanged.body.indexOf('No fields were changed') !== -1 && calls.every(function (call) { return !call.update; }));
  check('an unchanged form does not sign in again', signIns.length === signInsBeforeUnchanged);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const badBirthYear = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie },
    body: formBody({ birth_year: '99999' })
  }, {});
  check('a year outside the allowed range is rejected', badBirthYear.statusCode === 400 && badBirthYear.body.indexOf('not valid') !== -1 && calls.length === 0);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const badVet = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie },
    body: formBody({ is_vet: 'YES' })
  }, {});
  check('a veteran value the form cannot send is rejected', badVet.statusCode === 400 && calls.length === 0);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const duplicateName = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie },
    body: formBody() + '&first_name=Other'
  }, {});
  check('a repeated field is rejected', duplicateName.statusCode === 400 && calls.length === 0);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2', updatedRows: [] });
  const zeroRows = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie },
    body: formBody({ last_name: 'Abell' })
  }, {});
  const zeroWrite = calls.filter(function (call) { return call.update; })[0];
  check('a write that changes no row is not reported as saved', zeroRows.statusCode === 500 && zeroRows.body.indexOf('Nothing was saved') !== -1 && zeroRows.body.indexOf('updated successfully') === -1);
  same('that write still asked for every column back', zeroWrite && zeroWrite.select, '*');
  check('a zero-row write still used the supabase access token', zeroWrite && zeroWrite.accessToken === STUB_ACCESS_TOKEN);
  check('a zero-row write does not return the supabase token', responseCarriesSecret(zeroRows) === false);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: null });
  const missingCemetery = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie },
    body: formBody({ last_name: 'Abell' })
  }, {});
  check('a missing cemetery is reported and does not throw', missingCemetery.statusCode === 404 && missingCemetery.body.indexOf('not found') !== -1 && missingCemetery.body.indexOf('TypeError') === -1);
  check('a missing cemetery does not write', calls.every(function (call) { return !call.update; }));
  check('a missing cemetery is not described as a successful save', missingCemetery.body.indexOf('updated successfully') === -1);

  updateRecord.resetAdminAuthForTests();
  sessionExpiresInSeconds = 30;
  const signInsBeforeRefresh = signIns.length;
  const refreshesBefore = refreshes.length;
  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const firstShort = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
    body: formBody({ last_name: 'Abell' })
  }, {});
  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const secondShort = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
    body: formBody({ last_name: 'Abell' })
  }, {});
  sessionExpiresInSeconds = 3600;
  const refreshedWrite = calls.filter(function (call) { return call.update; })[0];
  check('a near-expiry session still saves', firstShort.statusCode === 200 && secondShort.statusCode === 200 && secondShort.body.indexOf('updated successfully') !== -1);
  check('a near-expiry session signs in once', signIns.length === signInsBeforeRefresh + 1);
  check('a near-expiry session refreshes instead of signing in again', refreshes.length === refreshesBefore + 1);
  check('the refreshed save uses the access token', refreshedWrite && refreshedWrite.accessToken === STUB_ACCESS_TOKEN && responseCarriesSecret(secondShort) === false);

  updateRecord.resetAdminAuthForTests();
  refreshShouldFail = true;
  const signInsBeforeUnauthorized = signIns.length;
  const refreshesBeforeUnauthorized = refreshes.length;
  reset({
    rows: [Object.assign({}, FULL_ROW)],
    view: 'bcmg_data_formatted_2',
    updateError: { message: 'JWT expired', code: 'PGRST301', status: 401 },
    updateErrorOnce: true
  });
  const retried = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
    body: formBody({ last_name: 'Abell' })
  }, {});
  refreshShouldFail = false;
  const retryWrites = calls.filter(function (call) { return call.update; });
  check('an unauthorized update signs in again and saves', retried.statusCode === 200 && retried.body.indexOf('updated successfully') !== -1 && retried.body.indexOf('Nothing was saved') === -1);
  check('an unauthorized update refreshes, then signs in again', refreshes.length === refreshesBeforeUnauthorized + 1 && signIns.length === signInsBeforeUnauthorized + 2);
  check('both attempts of an unauthorized update carry the access token', retryWrites.length === 2 && retryWrites.every(function (call) { return call.accessToken === STUB_ACCESS_TOKEN; }));
  check('an unauthorized update does not return the supabase token', responseCarriesSecret(retried) === false);

  updateRecord.resetAdminAuthForTests();
  signInShouldFail = true;
  const signInLogs = [];
  const originalConsoleError = console.error;
  console.error = function () {
    const parts = [];
    for (let i = 0; i < arguments.length; i += 1) {
      const part = arguments[i];
      if (typeof part === 'string') parts.push(part);
      else if (part && typeof part === 'object' && part.message) parts.push(String(part.message));
      else parts.push(String(part));
    }
    signInLogs.push(parts.join(' '));
    return originalConsoleError.apply(console, arguments);
  };
  let failedSignIn;
  try {
    reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
    failedSignIn = await updateRecord.handler({
      httpMethod: 'POST',
      headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
      body: formBody({ last_name: 'Abell' })
    }, {});
  } finally {
    console.error = originalConsoleError;
    signInShouldFail = false;
  }
  const failureLines = signInLogs.filter(function (line) { return line.indexOf('Supabase admin sign-in failed') !== -1; });
  const failureLog = signInLogs.join('\n');
  check('a failed Supabase sign-in shows the existing save error', failedSignIn.statusCode === 500 && failedSignIn.body.indexOf('Error Updating Record. Please try again.') !== -1);
  check('a failed Supabase sign-in is not a zero-row save', failedSignIn.body.indexOf('Nothing was saved') === -1);
  check('a failed Supabase sign-in does not write', calls.every(function (call) { return !call.update; }));
  check('a failed Supabase sign-in is logged once', failureLines.length === 1);
  check('a failed Supabase sign-in does not log the password, email, or token', failureLog.indexOf(SUPABASE_ADMIN_PASSWORD) === -1 && failureLog.indexOf(ADMIN_PASSWORD) === -1 && failureLog.indexOf(TEST_ADMIN_EMAIL) === -1 && failureLog.indexOf(STUB_ACCESS_TOKEN) === -1);
  check('a failed Supabase sign-in response has no token', responseCarriesSecret(failedSignIn) === false);
  let signInEntry = null;
  try {
    signInEntry = JSON.parse(failureLines[0] || '');
  } catch (error) {
    signInEntry = null;
  }
  check(
    'a failed Supabase sign-in log is one JSON object with function, path, message and timestamp',
    Boolean(signInEntry)
      && signInEntry.level === 'error'
      && signInEntry.function === 'updateRecord'
      && signInEntry.path === '/.netlify/functions/updateRecord'
      && signInEntry.message === 'Supabase admin sign-in failed'
      && signInEntry.stack === null
      && typeof signInEntry.timestamp === 'string'
      && signInEntry.timestamp.indexOf('T') !== -1
  );

  updateRecord.resetAdminAuthForTests();
  const savedSupabasePassword = process.env.SUPABASE_ADMIN_PASSWORD;
  delete process.env.SUPABASE_ADMIN_PASSWORD;
  const signInsBeforeFallback = signIns.length;
  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const fallbackSave = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
    body: formBody({ last_name: 'Abell' })
  }, {});
  const fallbackAttempt = signIns[signIns.length - 1];
  const fallbackWrite = calls.filter(function (call) { return call.update; })[0];
  check('an unset SUPABASE_ADMIN_PASSWORD falls back to ADMIN_PASSWORD', fallbackSave.statusCode === 200 && fallbackSave.body.indexOf('updated successfully') !== -1 && signIns.length === signInsBeforeFallback + 1 && fallbackAttempt.email === TEST_ADMIN_EMAIL && fallbackAttempt.usedSiteAdminPassword === true && fallbackAttempt.usedSupabaseAdminPassword === false);
  check('the fallback sign-in updates with the access token', fallbackWrite && fallbackWrite.accessToken === STUB_ACCESS_TOKEN && responseCarriesSecret(fallbackSave) === false);

  updateRecord.resetAdminAuthForTests();
  process.env.SUPABASE_ADMIN_PASSWORD = '';
  const signInsBeforeEmpty = signIns.length;
  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const emptyPasswordSave = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
    body: formBody({ last_name: 'Abell' })
  }, {});
  const emptyAttempt = signIns[signIns.length - 1];
  check('an empty SUPABASE_ADMIN_PASSWORD falls back to ADMIN_PASSWORD', emptyPasswordSave.statusCode === 200 && signIns.length === signInsBeforeEmpty + 1 && emptyAttempt.usedSiteAdminPassword === true && emptyAttempt.usedSupabaseAdminPassword === false);

  updateRecord.resetAdminAuthForTests();
  delete process.env.SUPABASE_ADMIN_PASSWORD;
  const savedSitePassword = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  const missingPasswordLogs = [];
  const originalMissingLog = console.error;
  console.error = function () {
    const parts = [];
    for (let i = 0; i < arguments.length; i += 1) {
      const part = arguments[i];
      if (typeof part === 'string') parts.push(part);
      else if (part && typeof part === 'object' && part.message) parts.push(String(part.message));
      else parts.push(String(part));
    }
    missingPasswordLogs.push(parts.join(' '));
    return originalMissingLog.apply(console, arguments);
  };
  let missingPassword;
  const signInsBeforeMissing = signIns.length;
  try {
    reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
    missingPassword = await updateRecord.handler({
      httpMethod: 'POST',
      headers: { cookie: adminCookie, 'x-forwarded-for': '198.51.100.10' },
      body: formBody({ last_name: 'Abell' })
    }, {});
  } finally {
    console.error = originalMissingLog;
    process.env.ADMIN_PASSWORD = savedSitePassword;
    process.env.SUPABASE_ADMIN_PASSWORD = savedSupabasePassword;
    updateRecord.resetAdminAuthForTests();
  }
  check('a save with no Supabase password shows the existing save error', missingPassword.statusCode === 500 && missingPassword.body.indexOf('Error Updating Record. Please try again.') !== -1 && missingPassword.body.indexOf('Nothing was saved') === -1);
  check('a save with no Supabase password does not write or call sign-in', calls.every(function (call) { return !call.update; }) && signIns.length === signInsBeforeMissing);
  check('a save with no Supabase password logs the sign-in failure', missingPasswordLogs.filter(function (line) { return line.indexOf('Supabase admin sign-in failed') !== -1; }).length === 1);

  const logoutLogin = await login.handler(loginEvent(ADMIN_PASSWORD, '198.51.100.30'), {});
  const logoutCookie = sessionPair(logoutLogin);
  const loggedOut = await logout.handler({ headers: { cookie: logoutCookie } }, {});
  const cleared = cookieHeaders(loggedOut).find(function (value) { return value.indexOf('mf_session=') === 0; });
  check('logout redirects home', loggedOut.statusCode === 302 && loggedOut.headers.Location === '/');
  check('logout clears the session cookie with the same attributes', Boolean(cleared) && cookieFlags(cleared) && cleared.indexOf('Max-Age=0') !== -1);
  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const reused = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: logoutCookie },
    body: formBody({ last_name: 'Abell' })
  }, {});
  check('a logged-out session cannot save', reused.statusCode === 401 && calls.length === 0);
  const revokedGate = await updatePage.handler({ headers: { cookie: logoutCookie } }, {});
  check('a logged-out session is not described as timed out', revokedGate.statusCode === 200 && revokedGate.body.indexOf('Admin login') !== -1 && revokedGate.body.indexOf('Session has timed out') === -1);
  reset({ rows: [Object.assign({}, FULL_ROW, { death_day: 12 })], view: 'bcmg_data_formatted_2' });
  const stillSignedIn = await getUpdateRecord.handler({
    headers: { cookie: adminCookie },
    queryStringParameters: { memorial_id: '1000004' }
  }, {});
  check('logging out one session leaves another session valid', stillSignedIn.statusCode === 200 && stillSignedIn.body.indexOf('value="12"') !== -1);

  const savedSecret = process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_SESSION_SECRET;
  const unconfigured = await login.handler(loginEvent(ADMIN_PASSWORD, '198.51.100.70'), {});
  check('login without a session secret fails closed', unconfigured.statusCode === 500 && !hasSessionCookie(unconfigured));
  process.env.ADMIN_SESSION_SECRET = 'short';
  const shortSecret = await login.handler(loginEvent(ADMIN_PASSWORD, '198.51.100.71'), {});
  check('login with a short session secret fails closed', shortSecret.statusCode === 500 && !hasSessionCookie(shortSecret));
  process.env.ADMIN_SESSION_SECRET = savedSecret;

  // --- 5. Sitemap, record SEO, and error reporting -----------------------
  const graveLd = jsonLd(grave.body);
  check('the grave page publishes Person structured data', Boolean(graveLd) && graveLd['@type'] === 'Person');
  same('structured data uses the page name order', graveLd && graveLd.name, 'Wilhelmina J Doe Abel, Jr');
  same('structured data uses the recorded birth and death dates', graveLd && [graveLd.birthDate, graveLd.deathDate], ['1907-01-28', '2008-09-12']);
  same('structured data names the cemetery as the burial place', graveLd && graveLd.burialPlace && graveLd.burialPlace.name, 'Capernaum Cemetery');
  same('the grave canonical URL is that record', canonicalHref(grave.body), 'https://memorafind.com/grave/1000004');
  check('the grave description names the person, the dates and the cemetery', metaContent(grave.body, 'name', 'description').indexOf('Wilhelmina J Doe Abel, Jr — born 01/28/1907, died 09/12/2008 — Capernaum Cemetery') === 0);
  check('Open Graph and Twitter titles stay equal to the document title', titleText(grave.body) !== '' && metaContent(grave.body, 'property', 'og:title') === titleText(grave.body) && metaContent(grave.body, 'name', 'twitter:title') === titleText(grave.body));
  check('Open Graph and Twitter descriptions stay equal to the meta description', metaContent(grave.body, 'property', 'og:description') === metaContent(grave.body, 'name', 'description') && metaContent(grave.body, 'name', 'twitter:description') === metaContent(grave.body, 'name', 'description'));
  check('the grave page is indexable', grave.body.indexOf('noindex') === -1);

  const emptyLd = jsonLd(emptyGrave.body);
  check('a record with no dates omits birthDate and deathDate', Boolean(emptyLd) && !Object.prototype.hasOwnProperty.call(emptyLd, 'birthDate') && !Object.prototype.hasOwnProperty.call(emptyLd, 'deathDate'));
  same('a record with no dates still names the person and the cemetery', emptyLd && [emptyLd.name, emptyLd.burialPlace && emptyLd.burialPlace.name], ['N Nobody', 'Honey Ford Cemetery']);
  check('an unrecorded date is not written into structured data as zero', emptyGrave.body.indexOf('birthDate') === -1 && emptyGrave.body.indexOf('deathDate') === -1);
  same('a missing record is noindex and has no canonical', [missing.body.indexOf('noindex') !== -1, canonicalHref(missing.body)], [true, '']);

  check('a cemetery search has its own description and canonical URL', metaContent(search.body, 'name', 'description').indexOf('Bamberg County Memory Gardens') !== -1 && canonicalHref(search.body) === 'https://memorafind.com/search/bcmg');
  check('an idle cemetery search canonicalises to that cemetery', canonicalHref(idle.body) === 'https://memorafind.com/search/capernaum' && metaContent(idle.body, 'name', 'description').indexOf('Capernaum Cemetery') !== -1);
  check('the administrator login page is noindex', openGate.body.indexOf('noindex') !== -1 && canonicalHref(openGate.body) === '');
  check('the administrator update page is noindex', signedGate.body.indexOf('name="robots" content="noindex, nofollow"') !== -1 && canonicalHref(signedGate.body) === 'https://memorafind.com/search/update');

  const home = await renderIndex.handler({}, {});
  const contact = await renderContact.handler({}, {});
  check('the landing page has the site description and the home canonical', home.statusCode === 200 && canonicalHref(home.body) === 'https://memorafind.com/' && metaContent(home.body, 'name', 'description').indexOf('free grave-finder') !== -1 && home.body.indexOf('noindex') === -1);
  check('the contact page has its own description and canonical', contact.statusCode === 200 && canonicalHref(contact.body) === 'https://memorafind.com/contact' && metaContent(contact.body, 'name', 'description').indexOf('Contact MemoraFind') !== -1 && contact.body.indexOf('noindex') === -1);

  reset();
  const unknownCemetery = await renderSearch.handler({ path: '/search/not-a-cemetery' }, {});
  check('an unknown cemetery is noindex and does not canonicalise home', unknownCemetery.statusCode === 404 && unknownCemetery.body.indexOf('noindex') !== -1 && canonicalHref(unknownCemetery.body) === '');

  reset({
    rows: [{
      memorial_id: 1000111,
      first_name: 'Ann',
      maiden_name: "O'Brien",
      last_name: 'A&B <test>',
      birth_month: 'Sep',
      birth_day: 2,
      birth_year: 1930,
      death_year: 2001
    }],
    view: 'bcmg_data_formatted_2'
  });
  const oddGrave = await renderGrave.handler({ path: '/grave/1000111' }, {});
  const oddLd = jsonLd(oddGrave.body);
  check('a name with markup cannot close the structured-data script', oddGrave.statusCode === 200 && oddGrave.body.indexOf('<test>') === -1 && oddGrave.body.indexOf('</script><script') === -1);
  same('structured data keeps that name and omits an unrecorded death day', oddLd && [oddLd.name, oddLd.birthDate, oddLd.deathDate, oddLd.burialPlace && oddLd.burialPlace.name], ["Ann O'Brien A&B <test>", '1930-09-02', '2001', 'Bamberg County Memory Gardens']);

  same('sitemap text escapes the five XML characters', sitemap.escapeXml('A&B<C>\'"'), 'A&amp;B&lt;C&gt;&apos;&quot;');
  reset({
    rows: [
      { memorial_id: 1000002 },
      { memorial_id: '1000001' },
      { memorial_id: 'nope' },
      { memorial_id: null }
    ]
  });
  const siteMap = await sitemap.handler({ httpMethod: 'GET', path: '/sitemap.xml' }, {});
  const locs = sitemapLocs(siteMap.body);
  check('the sitemap is XML with a cache header', siteMap.statusCode === 200 && siteMap.headers['Content-Type'].indexOf('application/xml') === 0 && siteMap.headers['Cache-Control'].indexOf('max-age=3600') !== -1 && siteMap.headers['Netlify-CDN-Cache-Control'].indexOf('s-maxage=86400') !== -1);
  same('the sitemap lists the public pages and each grave once, sorted', locs, [
    'https://memorafind.com/',
    'https://memorafind.com/contact',
    'https://memorafind.com/search/bcmg',
    'https://memorafind.com/search/capernaum',
    'https://memorafind.com/search/honeyford',
    'https://memorafind.com/grave/1000001',
    'https://memorafind.com/grave/1000002'
  ]);
  check('the sitemap does not list admin routes', siteMap.body.indexOf('update') === -1 && siteMap.body.indexOf('nope') === -1);
  const siteMapCalls = dataCalls();
  same('the sitemap reads memorial_id from each base table', siteMapCalls.map(function (call) { return call.table; }), ['bcmg_data', 'capernaum_data', 'honeyford_data']);
  check('the sitemap selects only memorial_id and pages the read', siteMapCalls.every(function (call) {
    return call.select === 'memorial_id' && call.range && call.range[0] === 0 && call.range[1] === 999 && call.order && call.order.column === 'memorial_id';
  }));

  reset({ error: { message: 'db down ' + process.env.SUPABASE_API_KEY } });
  const siteMapDown = await captureLogs(function () {
    return sitemap.handler({ httpMethod: 'GET', path: '/sitemap.xml?x=1' }, {});
  });
  check('a sitemap failure is a short 503 with no secret and no cache', siteMapDown.result.statusCode === 503 && siteMapDown.result.headers['Cache-Control'] === 'no-store' && siteMapDown.result.body.indexOf(process.env.SUPABASE_API_KEY) === -1 && siteMapDown.result.body.indexOf('<loc>') === -1);
  check('a sitemap failure logs the scrubbed database error', siteMapDown.lines.join('\n').indexOf('Could not build the sitemap') !== -1 && siteMapDown.lines.join('\n').indexOf(process.env.SUPABASE_API_KEY) === -1 && siteMapDown.lines.join('\n').indexOf('db down') !== -1);

  const robots = fs.readFileSync(path.resolve(__dirname, '../public/robots.txt'), 'utf8');
  const netlifyConfig = fs.readFileSync(path.resolve(__dirname, '../netlify.toml'), 'utf8');
  check('robots.txt points at the sitemap and disallows the admin routes', robots.indexOf('Sitemap: https://memorafind.com/sitemap.xml') !== -1 && robots.indexOf('Disallow: /.netlify/functions/updatePage') !== -1 && robots.indexOf('Disallow: /.netlify/functions/login') !== -1 && robots.indexOf('Disallow: /.netlify/functions/logout') !== -1 && robots.indexOf('Disallow: /.netlify/functions/updateRecord') !== -1 && robots.indexOf('Disallow: /.netlify/functions/getUpdateRecord') !== -1 && robots.indexOf('Disallow: /.netlify/functions/logClientError') !== -1 && robots.indexOf('Disallow: /search/update') !== -1);
  check('netlify.toml serves /sitemap.xml from the function', netlifyConfig.indexOf('from = "/sitemap.xml"') !== -1 && netlifyConfig.indexOf('to = "/.netlify/functions/sitemap"') !== -1);
  check('the committed static sitemap is gone', !fs.existsSync(path.resolve(__dirname, '../public/sitemap.xml')));

  logClientError.resetClientErrorLogForTests();
  errorReport.resetErrorReportingForTests();
  const clientOk = await captureLogs(function () {
    return logClientError.handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({
        kind: 'error',
        message: 'boom',
        stack: 'Error: boom\n    at page',
        path: '/grave/1000004?lastName=secret',
        password: ADMIN_PASSWORD,
        source: 'https://memorafind.com/grave/1000004'
      })
    });
  });
  let clientEntry = null;
  try {
    clientEntry = JSON.parse(clientOk.lines[0] || '');
  } catch (error) {
    clientEntry = null;
  }
  check('a browser error is accepted and logged without the query or the extra field', clientOk.result.statusCode === 204 && Boolean(clientEntry) && clientEntry.function === 'logClientError' && clientEntry.path === '/grave/1000004' && clientEntry.message === 'error: boom' && clientEntry.stack.indexOf('at page') !== -1 && typeof clientEntry.timestamp === 'string' && clientOk.lines.join('\n').indexOf(ADMIN_PASSWORD) === -1);

  const clientPromise = await captureLogs(function () {
    return logClientError.handler({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({ kind: 'unhandledrejection', message: 'rejected', path: 'https://memorafind.com/search/bcmg?lastName=Wil' })
    });
  });
  check('an unhandled rejection is logged against the pathname', clientPromise.result.statusCode === 204 && clientPromise.lines.join('\n').indexOf('unhandledrejection: rejected') !== -1 && clientPromise.lines.join('\n').indexOf('/search/bcmg') !== -1 && clientPromise.lines.join('\n').indexOf('lastName') === -1);

  const leaked = 'password=' + ADMIN_PASSWORD + ' key=' + process.env.SUPABASE_API_KEY;
  const clientSecret = await captureLogs(function () {
    return logClientError.handler({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.12' },
      body: JSON.stringify({ kind: 'error', message: leaked, stack: 'stack ' + process.env.SUPABASE_API_KEY })
    });
  });
  check('a browser report does not keep a password or the API key', clientSecret.result.statusCode === 204 && clientSecret.lines.join('\n').indexOf(ADMIN_PASSWORD) === -1 && clientSecret.lines.join('\n').indexOf(process.env.SUPABASE_API_KEY) === -1 && clientSecret.lines.join('\n').indexOf('[redacted]') !== -1);

  const tooBig = await captureLogs(function () {
    return logClientError.handler({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.13' },
      body: JSON.stringify({ kind: 'error', message: 'UNIQUE-BODY-MARKER-XYZ'.repeat(300) })
    });
  });
  check('an oversized browser report is rejected and not logged', tooBig.result.statusCode === 413 && tooBig.lines.join('\n').indexOf('UNIQUE-BODY-MARKER-XYZ') === -1);

  check('a browser report that is not JSON is rejected', (await logClientError.handler({ httpMethod: 'POST', headers: { 'x-forwarded-for': '203.0.113.14' }, body: '{' })).statusCode === 400);
  check('a browser report must be a POST', (await logClientError.handler({ httpMethod: 'GET', headers: { 'x-forwarded-for': '203.0.113.15' } })).statusCode === 405);

  logClientError.resetClientErrorLogForTests();
  let limited = null;
  for (let n = 0; n < logClientError.MAX_PER_WINDOW; n += 1) {
    limited = await logClientError.handler({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.16' },
      body: JSON.stringify({ kind: 'error', message: 'n' + n })
    });
    check('browser report ' + (n + 1) + ' under the limit is accepted', limited.statusCode === 204);
  }
  const overLimit = await logClientError.handler({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.16' },
    body: JSON.stringify({ kind: 'error', message: 'too many' })
  });
  const otherAddress = await logClientError.handler({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.17' },
    body: JSON.stringify({ kind: 'error', message: 'other address' })
  });
  check('the browser report endpoint rate limits one address', overLimit.statusCode === 429);
  check('a different address is not rate limited', otherAddress.statusCode === 204);

  const sentryCalls = [];
  errorReport.setSentryTransportForTests(function (target) {
    sentryCalls.push(target);
    return Promise.resolve();
  });
  const withoutDsn = await errorReport.logError({ functionName: 'renderIndex', message: 'no sentry' });
  check('Sentry is a no-op when SENTRY_DSN is unset', sentryCalls.length === 0 && withoutDsn.function === 'renderIndex' && withoutDsn.message === 'no sentry');
  process.env.SENTRY_DSN = 'https://super-secret-dsn-value@example.com/not-a-project';
  const badDsn = await captureLogs(function () {
    return errorReport.logError({ functionName: 'renderIndex', message: 'bad dsn' });
  });
  check('an unusable SENTRY_DSN does not send and is not logged', sentryCalls.length === 0 && badDsn.lines.join('\n').indexOf('super-secret-dsn-value') === -1 && badDsn.lines.join('\n').indexOf('not a usable https DSN') !== -1);
  process.env.SENTRY_DSN = 'https://publickey@o123.ingest.sentry.io/456';
  await errorReport.logError({
    functionName: 'renderGrave',
    path: '/grave/1000004',
    message: 'render failed password=' + ADMIN_PASSWORD,
    stack: 'stack ' + process.env.SUPABASE_API_KEY
  });
  const sentryBody = sentryCalls[0] && sentryCalls[0].body;
  const sentryHeader = sentryCalls[0] && sentryCalls[0].headers && sentryCalls[0].headers['X-Sentry-Auth'];
  check('Sentry receives the scrubbed report when SENTRY_DSN is set', sentryCalls.length === 1 && sentryCalls[0].path === '/api/456/envelope/' && String(sentryHeader).indexOf('sentry_key=publickey') !== -1 && String(sentryBody).indexOf(ADMIN_PASSWORD) === -1 && String(sentryBody).indexOf(process.env.SUPABASE_API_KEY) === -1 && String(sentryBody).indexOf('render failed') !== -1 && String(sentryBody).indexOf('/grave/1000004') !== -1);
  delete process.env.SENTRY_DSN;
  errorReport.resetErrorReportingForTests();

  const friendly = await captureLogs(function () {
    return errorReport.friendlyError({
      functionName: 'renderIndex',
      path: '/secret?password=' + ADMIN_PASSWORD,
      error: new Error('exploded ' + ADMIN_PASSWORD),
      message: 'Error rendering index.ejs'
    });
  });
  check('a friendly error page hides the exception and asks not to be indexed', friendly.result.statusCode === 500 && friendly.result.body.indexOf('Something went wrong') !== -1 && friendly.result.body.indexOf('noindex') !== -1 && friendly.result.body.indexOf(ADMIN_PASSWORD) === -1 && friendly.result.body.indexOf('exploded') === -1 && friendly.result.headers['Cache-Control'] === 'no-store');
  check('a friendly error log keeps the message and drops the secret', friendly.lines.join('\n').indexOf('Error rendering index.ejs') !== -1 && friendly.lines.join('\n').indexOf(ADMIN_PASSWORD) === -1 && friendly.lines.join('\n').indexOf('[redacted]') !== -1);

  const correctionYaml = fs.readFileSync(path.resolve(__dirname, '../.github/ISSUE_TEMPLATE/record_correction.yml'), 'utf8');
  same('the correction form ids the fields the grave page prefills', formFieldIds(correctionYaml), ['cemetery', 'record', 'record_id', 'name', 'wrong', 'correct', 'evidence']);
  check('the correction form cemetery options are the three display names', correctionYaml.indexOf('Bamberg County Memory Gardens') !== -1 && correctionYaml.indexOf('Capernaum Cemetery') !== -1 && correctionYaml.indexOf('Honey Ford Cemetery') !== -1);

  const correction = correctionLink(grave.body);
  check('a found grave page offers Report a correction in a new tab', Boolean(correction && correction.url) && grave.body.indexOf('>Report a correction<span class="visually-hidden"> (opens in a new tab)</span></a>') !== -1);
  same('the correction link opens the record correction form', correction && correction.url && (correction.url.origin + correction.url.pathname), 'https://github.com/dyarawilliams/MemoraFind/issues/new');
  same('the correction link selects the record correction template', correction && correction.url && correction.url.searchParams.get('template'), 'record_correction.yml');
  same('the correction title is the display name and record id', correction && correction.url && correction.url.searchParams.get('title'), 'Correction: Wilhelmina J Doe Abel, Jr (1000004)');
  same('the correction cemetery matches a form option', correction && correction.url && correction.url.searchParams.get('cemetery'), 'Capernaum Cemetery');
  same('the correction record link is the canonical grave URL', correction && correction.url && correction.url.searchParams.get('record'), 'https://memorafind.com/grave/1000004');
  same('the correction record id is the memorial id', correction && correction.url && correction.url.searchParams.get('record_id'), '1000004');
  same('the correction name matches the page heading', correction && correction.url && correction.url.searchParams.get('name'), 'Wilhelmina J Doe Abel, Jr');
  check('the correction href percent-encodes the title, cemetery and grave URL', Boolean(correction) && correction.raw.indexOf('title=Correction%3A%20Wilhelmina%20J%20Doe%20Abel%2C%20Jr%20(1000004)') !== -1 && correction.raw.indexOf('cemetery=Capernaum%20Cemetery') !== -1 && correction.raw.indexOf('record=https%3A%2F%2Fmemorafind.com%2Fgrave%2F1000004') !== -1 && correction.raw.indexOf('record_id=1000004') !== -1 && correction.raw.indexOf('name=Wilhelmina%20J%20Doe%20Abel%2C%20Jr') !== -1 && correction.raw.indexOf('+') === -1 && hrefAmpersandsAreEntities(correction.raw));
  check('the correction note says a free GitHub account is needed and links to Contact', grave.body.indexOf('free GitHub account') !== -1 && grave.body.indexOf('class="grave-note__contact" href="/contact"') !== -1);

  const emptyCorrection = correctionLink(emptyGrave.body);
  same('an unrecorded grave still prefills Honey Ford, the name and the record', emptyCorrection && emptyCorrection.url && [
    emptyCorrection.url.searchParams.get('cemetery'),
    emptyCorrection.url.searchParams.get('name'),
    emptyCorrection.url.searchParams.get('title'),
    emptyCorrection.url.searchParams.get('record'),
    emptyCorrection.url.searchParams.get('record_id')
  ], ['Honey Ford Cemetery', 'N Nobody', 'Correction: N Nobody (1000955)', 'https://memorafind.com/grave/1000955', '1000955']);

  const oddCorrection = correctionLink(oddGrave.body);
  same('a marked-up name is prefilled as text', oddCorrection && oddCorrection.url && [
    oddCorrection.url.searchParams.get('name'),
    oddCorrection.url.searchParams.get('title'),
    oddCorrection.url.searchParams.get('cemetery'),
    oddCorrection.url.searchParams.get('record'),
    oddCorrection.url.searchParams.get('record_id')
  ], ["Ann O'Brien A&B <test>", "Correction: Ann O'Brien A&B <test> (1000111)", 'Bamberg County Memory Gardens', 'https://memorafind.com/grave/1000111', '1000111']);
  check('the correction href encodes an apostrophe, an ampersand and angle brackets', Boolean(oddCorrection) && oddCorrection.raw.indexOf("name=Ann%20O&#39;Brien%20A%26B%20%3Ctest%3E") !== -1 && oddCorrection.raw.indexOf('title=Correction%3A%20Ann%20O&#39;Brien%20A%26B%20%3Ctest%3E%20(1000111)') !== -1 && oddCorrection.raw.indexOf('<') === -1 && oddCorrection.raw.indexOf('>') === -1 && hrefAmpersandsAreEntities(oddCorrection.raw));

  reset();
  const malformedGrave = await renderGrave.handler({ path: '/grave/not-an-id' }, {});
  const correctionAbsent = [
    ['a non-id grave address', malformedGrave.body],
    ['a missing record', missing.body],
    ['an unknown cemetery', unknownCemetery.body],
    ['a cemetery search', search.body],
    ['the landing page', home.body],
    ['the contact page', contact.body],
    ['the administrator login', openGate.body],
    ['the administrator update page', signedGate.body],
    ['a friendly error', friendly.result.body]
  ];
  correctionAbsent.forEach(function (entry) {
    check(entry[0] + ' does not offer Report a correction', entry[1].indexOf('grave-note__report') === -1 && entry[1].indexOf('record_correction.yml') === -1 && entry[1].indexOf('issues/new') === -1);
  });
  check('a non-id grave address is still a 404', malformedGrave.statusCode === 404);

  console.log(passed + ' checks passed');
  if (failures.length > 0) {
    console.error(failures.length + ' checks failed:');
    failures.forEach(function (failure) { console.error('  ' + failure); });
    process.exit(1);
  }

  console.log('');
  console.log('Not checked against a live database. select(\'*\') does not name');
  console.log('a column, so a missing name cannot reject the read. Which of');
  console.log('age_sane, notes, moved_from and moved_to the base tables lack');
  console.log('is still unknown; those four are on the formatted views and');
  console.log('absent from the scraper CSVs. No Supabase credentials here.');
  console.log('Sign-in is stubbed. The address is ' + TEST_ADMIN_EMAIL + ',');
  console.log('not a real Supabase user, and no request leaves this process.');
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
