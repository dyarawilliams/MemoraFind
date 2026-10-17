const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const path = require('path');
const { findCemetery } = require('./findCemetery');

//initialize connection to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

/*
 * One person's record, at an address of its own: /grave/<record ID>.
 *
 * The redirect in netlify.toml sends /grave/* here. The ID is read off the
 * request path, the same way renderSearch.js reads the cemetery slug off
 * /search/<cemetery>, and the record is then found through the existing
 * per-cemetery views — findCemetery.js resolves which of the three holds the
 * ID. The row itself is read from the BASE table behind that view (see
 * baseTableFor below), because the view does not carry the day of the month of
 * a death date: 2,154 records hold one and the view shows a day on none of
 * them, which meant the page showed "09/2008" for a death recorded as
 * 12 September 2008. Read-only: nothing here writes, and no query, filter or
 * column list beyond the table the read points at is changed.
 *
 * Status codes say what actually happened:
 *   200  the record was read
 *   404  the address is not a record ID, or no record here carries it
 *   503  the database could not be read, so nothing can be said about whether
 *        the record exists
 */

//The table a cemetery's data really lives in, from the name of the formatted
//view findCemetery.js resolved the record through.
//
//This is the SAME derivation the save path uses (netlify/functions/updateRecord.js:
//`cemetery.split("_", 2).join("_")`, i.e. "bcmg_data_formatted_2" -> "bcmg_data"),
//applied to the same input, so a page can only ever show the table a save writes
//to. It is deliberately not a hand-written table of names: a second list could
//drift away from the write.
function baseTableFor(cemeteryView) {
  return String(cemeteryView).split('_', 2).join('_');
}

//The base table keeps a date as three separate columns — the month as a name
//("Jan", "Sep"), the day and the year as numbers — while the page's display
//rules (partials/record-display.ejs) read one string. So the parts are put back
//together in the shape that file documents: month/day/year, with a zero standing
//for a part that was never recorded ("01/28/1907", "09/12/2008", "0/0/1967").
//Those rules drop a zero, so no zero is ever printed, and they suppress a day
//that has no month. The month is written as a two-digit number because that is
//how the formatted views write it (the view renders the same "Sep" as "09").
const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

//A stored part of a date, or "" when nothing was recorded. A stored 0 is a
//placeholder meaning "not recorded" here as much as an empty cell is.
function recordedPart(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (text === '' || /^0+$/.test(text)) return '';
  return text;
}

//The month as a two-digit number: a stored name ("Sep", "September") or a
//stored number. Anything unrecognisable counts as not recorded.
function monthPart(value) {
  const part = recordedPart(value);
  if (part === '') return '';
  if (/^\d+$/.test(part)) return part.length === 1 ? '0' + part : part;
  return MONTHS[part.slice(0, 3).toLowerCase()] || '';
}

//The day, as stored. A day is only used when the record also carries its month,
//so a stray day can never be printed as though it were a month.
function dayPart(value) {
  const part = recordedPart(value);
  return /^\d+$/.test(part) ? part : '';
}

//The year. The display rules take a four-digit part as the year and nothing
//else, so anything that is not four digits is left out rather than misplaced.
function yearPart(value) {
  const part = recordedPart(value);
  return /^\d{4}$/.test(part) ? part : '';
}

//One date column of the base table, as the single string the display rules read.
function composedDate(month, day, year) {
  const monthText = monthPart(month);
  const dayText = monthText === '' ? '' : dayPart(day);
  const yearText = yearPart(year);
  if (monthText === '' && dayText === '' && yearText === '') return '';
  return (monthText || '0') + '/' + (dayText || '0') + '/' + (yearText || '0');
}

//The row as public/views/grave.ejs expects it: the base table's own columns,
//plus the birth_date / death_date strings the page's display rules parse, and
//the age the record carries (age_sane if the base table has that column; the
//year difference the view itself worked out otherwise). A column the base table
//does not have stays absent, and the page then renders exactly as it does for a
//record with nothing recorded in it — never "undefined", never an empty row.
function displayRecord(row) {
  const record = Object.assign({}, row, {
    birth_date: composedDate(row.birth_month, row.birth_day, row.birth_year),
    death_date: composedDate(row.death_month, row.death_day, row.death_year)
  });
  if (recordedPart(record.age_sane) === '') {
    const bornYear = Number(yearPart(row.birth_year));
    const diedYear = Number(yearPart(row.death_year));
    const years = (bornYear && diedYear) ? diedYear - bornYear : 0;
    record.age_sane = years > 0 ? String(years) : '';
  }
  return record;
}

//The three views findCemetery.js can resolve, with the cemetery's display name
//and the slug its search page is built from.
const CEMETERIES = {
  bcmg_data_formatted_2: { name: 'Bamberg County Memory Gardens', slug: 'bcmg' },
  capernaum_data_formatted_2: { name: 'Capernaum Cemetery', slug: 'capernaum' },
  honeyford_data_formatted_2: { name: 'Honey Ford Cemetery', slug: 'honeyford' }
};

//A record ID is a number, the same shape getUpdateRecord.js requires. Anything
//else ("abc", an empty segment) cannot be looked up: the column is numeric.
const MEMORIAL_ID_PATTERN = /^\d+$/;

//The requested path is /grave/<id>, with or without a trailing slash. A
//trailing slash captures an empty ID, which is bad input rather than a record
//that is missing.
const GRAVE_PATH = /\/grave\/([^/?#]*)\/?$/i;

//The record ID the visitor asked for, or "" when the address does not name one.
function requestedMemorialId(event) {
  const candidates = [(event || {}).path, (event || {}).rawUrl];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const match = candidate.match(GRAVE_PATH);
    if (!match) continue;
    let raw = match[1];
    try {
      //A hand-typed %-escape must not turn into an uncaught error.
      raw = decodeURIComponent(raw);
    } catch (error) {
      //Not a valid escape: the segment as typed is judged below.
    }
    return raw.trim();
  }
  //A direct call to the function itself (with the ID in the query string) is
  //also answered, which is how the offline harness drives it.
  const params = (event || {}).queryStringParameters || {};
  return (typeof params.memorial_id === 'string') ? params.memorial_id.trim() : '';
}

//Render one of the page's states, always as HTML, always escaping the values.
async function renderTemplate(templateName, templateData, statusCode, plainTextFallback) {
  try {
    const templatePath = path.resolve(__dirname, '../../public/views/' + templateName);
    const html = await ejs.renderFile(templatePath, templateData);

    return {
      statusCode,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  } catch (error) {
    //A template that cannot be rendered is still not a stack trace.
    console.error('Error rendering ' + templateName + ':', error);
    return {
      statusCode,
      headers: { 'Content-Type': 'text/plain' },
      body: plainTextFallback
    };
  }
}

function renderGravePage(locals) {
  return renderTemplate('grave.ejs', locals, 200, 'Record could not be displayed');
}

function renderGraveNotFoundPage(requestedId, malformed) {
  return renderTemplate('grave-not-found.ejs', { requestedId, malformed }, 404, 'Record not found');
}

function renderGraveUnavailablePage(requestedId) {
  return renderTemplate('grave-unavailable.ejs', { requestedId }, 503, 'The record database is temporarily unavailable.');
}

//export function
exports.handler = async function (event, context) {
  const requestedId = requestedMemorialId(event);

  //An address that does not name a record ID is answered as bad input. No
  //lookup is attempted, so this cannot be mistaken for a missing record — or
  //for the database being down.
  if (!MEMORIAL_ID_PATTERN.test(requestedId)) {
    return renderGraveNotFoundPage(requestedId, true);
  }

  //findCemetery throws when the database cannot be read at all. Answer with a
  //page rather than letting the throw reach the visitor as a 502 whose body
  //carries a stack trace and internal file paths.
  let cemeteryView;
  try {
    cemeteryView = await findCemetery(requestedId);
  } catch (error) {
    console.error('Database error while finding the cemetery for memorial ID', requestedId, ':', error);
    return renderGraveUnavailablePage(requestedId);
  }

  //Not in any of the three cemeteries.
  if (!cemeteryView) {
    return renderGraveNotFoundPage(requestedId, false);
  }

  //Read the one record that was asked for, from the base table behind the view:
  //the record ID is the only filter, and the result is capped to a single row.
  //Every column is taken, so a column the page shows is read from the table the
  //save writes whenever the base table has it.
  let record = null;
  const baseTable = baseTableFor(cemeteryView);
  try {
    const { data, error } = await supabase
      .from(baseTable)
      .select('*')
      .eq('memorial_id', requestedId)
      .limit(1);

    if (error) throw error;
    record = (Array.isArray(data) && data.length > 0) ? data[0] : null;
  } catch (error) {
    console.error('Database query error for memorial ID', requestedId, ':', error);
    console.error('Supabase error details:', {
      code: error && error.code,
      message: error && error.message,
      details: error && error.details,
      hint: error && error.hint
    });
    return renderGraveUnavailablePage(requestedId);
  }

  if (!record) {
    return renderGraveNotFoundPage(requestedId, false);
  }

  const cemetery = CEMETERIES[cemeteryView] || {};

  return renderGravePage({
    record: displayRecord(record),
    cemeteryName: cemetery.name || '',
    cemeteryCode: cemetery.slug || ''
  });
};
