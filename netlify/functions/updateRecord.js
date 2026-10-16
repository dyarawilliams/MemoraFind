const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const path = require('path');
//Used to validate logged-in users
const cookie = require('cookie');
//Used to parse POST requests
const querystring = require('querystring');
const { findCemetery } = require('./findCemetery');

//Columns the database holds as numbers. PostgREST hands them back as numbers
//while an HTML form always posts strings, so they have to be compared as
//numbers — compared as strings "1907" never equals 1907 and every submit looked
//like a change to the dates.
const NUMERIC_COLUMNS = ['birth_year', 'birth_day', 'death_year', 'death_day'];

//An empty form field and an empty column mean the same thing.
function isEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

//True when the submitted value genuinely differs from the stored one.
function valueChanged(key, submitted, stored) {
  if (NUMERIC_COLUMNS.indexOf(key) !== -1) {
    if (isEmptyValue(submitted) || isEmptyValue(stored)) {
      return isEmptyValue(submitted) !== isEmptyValue(stored);
    }

    const submittedNumber = Number(submitted);
    const storedNumber = Number(stored);

    //Anything that is not a number on both sides falls through and is compared
    //as it stands, so a bad value is still treated as a change.
    if (!isNaN(submittedNumber) && !isNaN(storedNumber)) {
      return submittedNumber !== storedNumber;
    }
  }

  if (isEmptyValue(submitted) && isEmptyValue(stored)) {
    return false;
  }

  return String(submitted) !== String(stored);
}

//Thrown when the database accepts a write but changes no row. It is a different
//failure from a rejected query, and it is reported to the volunteer in words of
//its own instead of being passed off as a save.
class NothingSavedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NothingSavedError';
  }
}


async function updateRecordInSupabase(supabase, formData) {
  try {
    const memorial_id = formData.memorial_id;

    // Check if the memorial_id is valid
    if (!memorial_id || isNaN(memorial_id)) {
      throw new Error('Invalid or missing Memorial ID. Please provide a valid Memorial ID.');
    }
    // Check if their is a cemetery that exists for the given memorial_id
    const cemetery = await findCemetery(memorial_id);
    
    // Split the cemetery name to get the table name for example if the cemetery is "capernaum_data_formatted_2" then the table name is "capernaum_data
    const tableName = cemetery.split("_", 2).join("_");
    
    // Check if the cemetery name is valid
    if (!cemetery) {
      throw new Error(`Cemetery not found for memorial ID ${memorial_id}`);
    }
    
    // Check if the table name is valid
    if (!tableName) {
      throw new Error('Invalid table name');
    }

   // Fetch the current record from the database to compare against submitted data
    const { data: currentData, error: fetchError } = await supabase
      .from(tableName)
      .select('*')
      .eq('memorial_id', memorial_id)
      .single();
    
    // If there is an error checking the record, throw an error
    if (fetchError) {
      throw fetchError;
    }
    
    // If the record does not exist, throw an error
    if (!currentData) {
      throw new Error(`Memorial ID ${memorial_id} not found in cemetery ${cemetery}.`);
    }

    // Construct the update payload with only changed fields by comparing against old record
    const updatePayload = {};

    // Loop through formData and compare with currentData
    for (const key in formData) {
      // Skip the memorial_id field
      if (key === 'memorial_id') {
        continue;
      }

      // Normalize null values in currentData
      currentData[key] = currentData[key] === null ? "" : currentData[key];

      // Check if the field exists in formData and has changed
      if (formData[key] !== undefined && valueChanged(key, formData[key], currentData[key])) {
        // Add to update payload only if the value has changed
        if (formData[key] === '' && currentData[key] === "") {
          updatePayload[key] = null; // Keep it as null if both are effectively empty
        } else {
          updatePayload[key] = formData[key] === '' ? null : formData[key];
        }
      }
    }
    // console.log('Update payload:', updatePayload);
    if (Object.keys(updatePayload).length === 0) {
      //Nothing differed from what is stored, so nothing is written and no save
      //is reported either. The handler answers on `fieldsChanged`.
      return { fieldsChanged: false, data: currentData };
    }

    // Perform the update with the constructed payload, and ask for the rows the
    // database actually changed. Without .select() the answer carries no rows at
    // all, so a write that no policy permits — Supabase reports that as no error
    // and zero rows — could not be told apart from a real save.
    const { data: updatedRows, error: updateError } = await supabase
      .from(tableName)
      .update(updatePayload)
      .eq('memorial_id', memorial_id)
      .select('memorial_id');

    if (updateError) {
      console.error('Error updating record:', updateError);
      throw new Error('Failed to update the record. Please try again.');
    }

    // Zero rows changed: the request was accepted, nothing was stored.
    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      throw new NothingSavedError(`The database accepted the update for memorial ID ${memorial_id} in ${tableName} but changed no rows.`);
    }

    return { fieldsChanged: true, data: updatedRows };
  } catch (error) {
    console.error('Error updating record in Supabase:', error);
    throw error;
  }
}

exports.handler = async function (event, context) {
  // Parse cookies from the request headers
  const cookies = cookie.parse(event.headers.cookie || '');
  const token = cookies.token;

  //Add the token to the supabase headers to authenticate against DB policy
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });

  //If the token has expired, send the user back to the login page
  if (!token) {
    const templatePath = path.resolve(__dirname, '../../public/views/login.ejs');
    const html = await ejs.renderFile(templatePath, { message: 'Session has timed out. Please log in again.' });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  }

  //Get the update information from the POST request
  const formData = querystring.parse(event.body);

  try {
    memorial_id = formData.memorial_id;
    // Try to update the database (see function definition)
    const result = await updateRecordInSupabase(supabase, formData);

    const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');

    // The submit matched what is already stored, so no write was made: say that
    // rather than reporting an update that never happened.
    if (result && result.fieldsChanged === false) {
      const html = await ejs.renderFile(templatePath, { record: null, message: 'No fields were changed, so the record was left as it is.'});

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: html
      };
    }

    // If it worked, show the memorial ID to the user
    const html = await ejs.renderFile(templatePath, { record: null, message: `Record ${memorial_id} has been updated successfully.`});

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  } catch (error) {

    // If it didn't work, show a error message to the user.
    console.error('Error updating record:', error);
    const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');

    // The database took the write but changed no row. Nothing was saved, and
    // that is what the volunteer is told: this is the case that used to answer
    // "has been updated successfully." with no error and zero rows written.
    if (error && error.name === 'NothingSavedError') {
      const html = await ejs.renderFile(templatePath, { record: null, message: 'Nothing was saved. The database did not change this record. Please check the record is still there, and tell a library administrator if this happens again.' });

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'text/html' },
        body: html
      };
    }

    const html = await ejs.renderFile(templatePath, { record: null, message: 'Error Updating Record. Please try again.' });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  }
};
