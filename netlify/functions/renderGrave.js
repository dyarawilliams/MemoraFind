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
 * ID, and one read of that view returns the single row. Read-only: nothing
 * here writes, and no existing query, column list or filter is changed.
 *
 * Status codes say what actually happened:
 *   200  the record was read
 *   404  the address is not a record ID, or no record here carries it
 *   503  the database could not be read, so nothing can be said about whether
 *        the record exists
 */

//The same columns the search cards read (netlify/functions/renderSearch.js), so
//a person's record reads identically on a card and on their own page.
const RECORD_COLUMNS = `
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
`;

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

  //Read the one record that was asked for: the record ID is the only filter,
  //and the result is capped to a single row.
  let record = null;
  try {
    const { data, error } = await supabase
      .from(cemeteryView)
      .select(RECORD_COLUMNS)
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
    record,
    cemeteryName: cemetery.name || '',
    cemeteryCode: cemetery.slug || ''
  });
};
