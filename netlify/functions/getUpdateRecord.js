const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const path = require('path');
const { findCemetery } = require('./findCemetery');
const { baseTableFor } = require('./baseRecord');
const { requireAdmin } = require('./adminSession');

//initialize connection to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

//Shown whenever the database cannot be read. The visitor is told the truth about
//the lookup failing; the real Supabase error goes to the function log only.
const DATABASE_UNAVAILABLE_MESSAGE = 'The record database is temporarily unavailable. Please try again shortly.';

//Shown when the value typed into the lookup box is not a Memorial ID at all
//("abc", "12 34"). A Memorial ID is a number, so anything else would be rejected
//by the database and used to be reported as an outage — the wrong cause, and
//advice that retrying could never fix. It is answered as bad input instead, and
//the wording is deliberately nothing like the outage message.
const INVALID_MEMORIAL_ID_MESSAGE = 'A Memorial ID is a number, for example 1001728. Please check the record ID shown on the card and try again.';

//A Memorial ID is numeric; validating it decides whether the lookup runs at all
//and changes nothing about how a real ID is queried.
const MEMORIAL_ID_PATTERN = /^\d+$/;

//Why the form does not read the view it used to: the view drops the day of the
//month from the death date (2,154 records carry one, the view shows none of
//them), while the base table holds it. A form rendered from the view therefore
//shows a death day that is empty for a record that has one, and an untouched
//save would clear it. Reading the base table shows what is stored, which is also
//what the save compares against. Which table that is comes from baseTableFor
//(baseRecord.js), not from a second copy of the name.

//Render the update page (lookup form plus a message) as an HTML response.
async function renderUpdatePage(templateData) {
  const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
  const html = await ejs.renderFile(templatePath, templateData);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
    body: html
  };
}

//export function
exports.handler = async function (event, context) {
  const gate = await requireAdmin(event || {}, 401);
  if (gate.response) return gate.response;

  const memorial_id = (event.queryStringParameters || {}).memorial_id;

  // Handle the user clicking "Search" without entering a value in the box
  // If the user clicks "Search" without entering a value, return a message
  // and render the update form with a message

  if (!memorial_id) {
    return await renderUpdatePage({ record: null, message: 'Please enter a valid Memorial ID to search.' });
  }

  // A Memorial ID that is not a number cannot be looked up: the column is
  // numeric and the database rejects the value. Say what is wrong with the
  // input instead of reporting a database outage. No lookup is attempted, so
  // this cannot be mistaken for — or caused by — the database being down.
  if (!MEMORIAL_ID_PATTERN.test(String(memorial_id).trim())) {
    return await renderUpdatePage({ record: null, message: INVALID_MEMORIAL_ID_MESSAGE });
  }

  // findCemetery throws when the database cannot be read at all. Answer with a
  // plain message instead of letting the throw reach the visitor as a 502 whose
  // body carries a stack trace and internal file paths.
  let cemetery;
  try {
    cemetery = await findCemetery(memorial_id);
  } catch (error) {
    console.error('Database error while finding the cemetery for memorial ID', memorial_id, ':', error);
    return await renderUpdatePage({ record: null, message: DATABASE_UNAVAILABLE_MESSAGE });
  }

  // If the cemetery variable is still null after checking all views,
  // it means the memorial_id was not found in any cemetery
  if (!cemetery) {
    const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
    const templateData = { record: null, message: `Memorial ID ${memorial_id} not found in any cemetery.` };

    const html = await ejs.renderFile(templatePath, templateData);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
      body: html
    };
  }

  // If the cemetery variable is not null, it means the memorial_id was found
  // in one of the cemetery views
  // The record itself is read from the base table the save writes to, not from
  // the view. baseTableFor is the shared map in baseRecord.js.
  const baseTable = baseTableFor(cemetery);
  // Set up query to get the record from the cemetery's base table
  // Use the base table derived from the cemetery variable to select the table
  const query2 = supabase
    .from(baseTable)
    .select('*')
    .eq('memorial_id', memorial_id);

  try {
    // Execute the query and get the record
    const { data: record, error } = await query2;
    // If there is an error, log it and return an error message
    if (error) {
      throw error;
    }

    // If the record is not found, return a message and render the update form with a message
    if (record.length === 0) {
      const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
      // The table named here is the one that was actually read, so the message
      // stays true after the read moved from the view to the base table.
      const templateData = { record: null, message: `Memorial ID ${memorial_id} not found in ${baseTable}.` };

      const html = await ejs.renderFile(templatePath, templateData);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
        body: html
      };
    } else {
      // If the record is found, render the update form with the record data
      const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
      const templateData = { record: record[0], message: null };
      // console.log(templateData)
      
      const html = await ejs.renderFile(templatePath, templateData);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
        body: html
      };
    }

  } catch (error) {
    // The record could not be read (or the query itself failed). Say so plainly
    // and keep the real error, with its code, in the function log.
    console.error('Database query error:', error);
    console.error('Supabase error details:', {
      code: error && error.code,
      message: error && error.message,
      details: error && error.details,
      hint: error && error.hint
    });
    return await renderUpdatePage({ record: null, message: DATABASE_UNAVAILABLE_MESSAGE });
  }
};
