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
 * cemetery. This script sets the admin environment variables itself.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');
const querystring = require('querystring');

const ADMIN_PASSWORD = 'correct-horse-battery';

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
let next = { rows: [], count: null, error: null, view: null };

function respond(state) {
  if (state.update) {
    if (next.updateError) return { data: null, error: next.updateError };
    if (Array.isArray(next.updatedRows)) return { data: next.updatedRows, error: null };
    return { data: next.rows, error: null };
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
  if (next.error) return { data: null, count: null, error: next.error };
  return { data: next.rows, count: next.count, error: null };
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
          error: result.error
        };
      }
      return Promise.resolve(result).then(resolve, reject);
    }
  };
  return builder;
}

function createClient() {
  return {
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
        single: false
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

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_API_KEY = process.env.SUPABASE_API_KEY || 'test-key';
process.env.ADMIN_EMAIL = 'admin@memorafind.test';
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
process.env.ADMIN_SESSION_SECRET = 'test-session-secret-0123456789';
delete process.env.ADMIN_PASSWORD_HASH;

const baseRecord = require('../netlify/functions/baseRecord');
const renderSearch = require('../netlify/functions/renderSearch');
const renderGrave = require('../netlify/functions/renderGrave');
const getUpdateRecord = require('../netlify/functions/getUpdateRecord');
const login = require('../netlify/functions/login');
const logout = require('../netlify/functions/logout');
const updatePage = require('../netlify/functions/updatePage');
const updateRecord = require('../netlify/functions/updateRecord');
const adminSession = require('../netlify/functions/adminSession');

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
    grave.body.indexOf('née Doe') !== -1);
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
    const lookedUp = calls.filter(function (call) { return String(call.table).endsWith('_formatted_2'); }).map(function (call) { return call.table; });
    check('findCemetery was consulted for ' + view, lookedUp.indexOf(view) !== -1);
  }

  const updateSourceHasLocalCopy = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/getUpdateRecord.js'), 'utf8').indexOf("split('_', 2)") !== -1;
  check('getUpdateRecord no longer has its own split', updateSourceHasLocalCopy === false);

  // --- 4. Admin session and the save path --------------------------------
  const loginSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/login.js'), 'utf8');
  const authSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/adminSession.js'), 'utf8');
  check('login no longer hard-codes the admin email', loginSource.indexOf('memorafind@gmail.com') === -1);
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
  const signedGate = await updatePage.handler({ headers: { cookie: adminCookie } }, {});
  check('update page with a session is the edit gate', signedGate.statusCode === 200 && signedGate.body.indexOf('Find a record') !== -1);
  const forgedCookie = adminCookie.slice(0, -1) + (adminCookie.slice(-1) === 'a' ? 'b' : 'a');
  const forgedGate = await updatePage.handler({ headers: { cookie: forgedCookie } }, {});
  check('a forged session cookie is rejected', forgedGate.statusCode === 200 && forgedGate.body.indexOf('Admin login') !== -1);

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const anonymousLookup = await getUpdateRecord.handler({
    headers: {},
    queryStringParameters: { memorial_id: '1000004' }
  }, {});
  check('an anonymous lookup is rejected', anonymousLookup.statusCode === 401 && anonymousLookup.body.indexOf('Admin login') !== -1);
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
  }

  reset({ rows: [Object.assign({}, FULL_ROW)], view: 'bcmg_data_formatted_2' });
  const unchanged = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie },
    body: formBody()
  }, {});
  check('an unchanged form does not write', unchanged.statusCode === 200 && unchanged.body.indexOf('No fields were changed') !== -1 && calls.every(function (call) { return !call.update; }));

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

  reset({ rows: [Object.assign({}, FULL_ROW)], view: null });
  const missingCemetery = await updateRecord.handler({
    httpMethod: 'POST',
    headers: { cookie: adminCookie },
    body: formBody({ last_name: 'Abell' })
  }, {});
  check('a missing cemetery is reported and does not throw', missingCemetery.statusCode === 404 && missingCemetery.body.indexOf('not found') !== -1 && missingCemetery.body.indexOf('TypeError') === -1);
  check('a missing cemetery does not write', calls.every(function (call) { return !call.update; }));
  check('a missing cemetery is not described as a successful save', missingCemetery.body.indexOf('updated successfully') === -1);

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
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
