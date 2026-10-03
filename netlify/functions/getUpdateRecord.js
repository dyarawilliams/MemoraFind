const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const path = require('path');
const { findCemetery } = require('./findCemetery');

//initialize connection to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

//Shown whenever the database cannot be read. The visitor is told the truth about
//the lookup failing; the real Supabase error goes to the function log only.
const DATABASE_UNAVAILABLE_MESSAGE = 'The record database is temporarily unavailable. Please try again shortly.';

//Render the update page (lookup form plus a message) as an HTML response.
async function renderUpdatePage(templateData) {
  const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
  const html = await ejs.renderFile(templatePath, templateData);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html
  };
}

//export function
exports.handler = async function (event, context) {

  const memorial_id = (event.queryStringParameters || {}).memorial_id;

  // Handle the user clicking "Search" without entering a value in the box
  // If the user clicks "Search" without entering a value, return a message
  // and render the update form with a message

  if (!memorial_id) {
    templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
    templateData = { record: null, message: 'Please enter a valid Memorial ID to search.' };

    const html = await ejs.renderFile(templatePath, templateData);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
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
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  }

  // If the cemetery variable is not null, it means the memorial_id was found
  // in one of the cemetery views
  // Set up query to get the record from the cemetery view
  // Use the cemetery variable to dynamically select the table
  const query2 = supabase
    .from(cemetery)
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
      const templateData = { record: null, message: `Memorial ID ${memorial_id} not found in ${cemetery}.` };

      const html = await ejs.renderFile(templatePath, templateData);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
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
        headers: { 'Content-Type': 'text/html' },
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
