/*
 * Checks the three review fixes without a database and without a test runner.
 *
 *   node tools/verify-review-fixes.js
 *
 * The real handlers and the real EJS templates run against a stubbed Supabase
 * client. The script exits 0 when every check passes, and 1 otherwise.
 *
 * What a stub cannot tell us is whether every name in BASE_RECORD_COLUMNS
 * exists on the live base tables. That limit is printed at the end.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

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
    then: function (resolve, reject) {
      const snapshot = JSON.parse(JSON.stringify(state));
      calls.push(snapshot);
      return Promise.resolve(respond(state)).then(resolve, reject);
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
        limit: null
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

const baseRecord = require('../netlify/functions/baseRecord');
const renderSearch = require('../netlify/functions/renderSearch');
const renderGrave = require('../netlify/functions/renderGrave');
const getUpdateRecord = require('../netlify/functions/getUpdateRecord');

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

  // --- 2. Explicit columns ------------------------------------------------
  const columnList = baseRecord.BASE_RECORD_COLUMNS.join(',');
  same('search select list is the shared column list', searchCall.select, columnList);
  check('search does not select *', searchCall.select !== '*' && searchCall.select.indexOf('*') === -1);

  const templateFiles = [
    'public/views/search.ejs',
    'public/views/grave.ejs',
    'public/views/partials/fact-burial-location.ejs'
  ];
  const composed = { birth_date: true, death_date: true };
  const used = {};
  templateFiles.forEach(function (file) {
    const text = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    const re = /(?:record|__locationRecord)\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let match;
    while ((match = re.exec(text))) used[match[1]] = file;
    const literal = /record\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g;
    while ((match = literal.exec(text))) used[match[1]] = file;
  });
  Object.keys(used).forEach(function (field) {
    if (composed[field]) {
      check(field + ' is composed by displayRecord, not selected', baseRecord.BASE_RECORD_COLUMNS.indexOf(field) === -1);
      return;
    }
    check('column list includes ' + field + ' (' + used[field] + ')', baseRecord.BASE_RECORD_COLUMNS.indexOf(field) !== -1);
  });
  ['birth_month', 'birth_day', 'birth_year', 'death_month', 'death_day', 'death_year', 'age_sane'].forEach(function (field) {
    check('displayRecord input ' + field + ' is selected', baseRecord.BASE_RECORD_COLUMNS.indexOf(field) !== -1);
  });
  check('templates mention notes, moved_from and moved_to', used.notes && used.moved_from && used.moved_to && used.section && used.lot && used.age_sane);

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
  same('grave select list is the shared column list', graveCall && graveCall.select, columnList);
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

  // The write path (updateRecord.js) was not part of this change. For every
  // cemetery the site has, its split and this map still name the same table.
  const updateSource = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/updateRecord.js'), 'utf8');
  check('the save path still derives its table with split', updateSource.indexOf('split("_", 2).join("_")') !== -1);

  const views = {
    bcmg_data_formatted_2: 'bcmg_data',
    capernaum_data_formatted_2: 'capernaum_data',
    honeyford_data_formatted_2: 'honeyford_data'
  };
  const viewNames = Object.keys(views);
  for (let i = 0; i < viewNames.length; i += 1) {
    const view = viewNames[i];
    reset({
      rows: [Object.assign({}, FULL_ROW, { death_day: 12 })],
      view: view
    });
    const page = await getUpdateRecord.handler({
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

  console.log(passed + ' checks passed');
  if (failures.length > 0) {
    console.error(failures.length + ' checks failed:');
    failures.forEach(function (failure) { console.error('  ' + failure); });
    process.exit(1);
  }

  console.log('');
  console.log('Not checked against a live database: whether every name in');
  console.log('BASE_RECORD_COLUMNS exists on bcmg_data, capernaum_data and');
  console.log('honeyford_data. notes, moved_from, moved_to and age_sane are');
  console.log('included because the templates and displayRecord read them.');
  console.log('A name the base table does not have makes PostgREST reject the');
  console.log('query (search says the database is unavailable; a grave page');
  console.log('answers 503). No Supabase credentials are in this environment.');
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
