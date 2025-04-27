const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const path = require('path');
//Used to validate logged-in users
const cookie = require('cookie');
//Used to parse POST requests
const querystring = require('querystring');
const { findCemetery } = require('./findCemetery');


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

    // Check if the memorial_id exists in the tableName
    const { data: existingRecord, error: checkError } = await supabase
      .from(tableName)
      .select('*')
      .eq('memorial_id', memorial_id)
      .single();
    
    // If there is an error checking the record, throw an error
    if (checkError) {
      throw checkError;
    }
    
    // If the record does not exist, throw an error
    if (!existingRecord) {
      throw new Error(`Memorial ID ${memorial_id} not found in cemetery ${cemetery}.`);
    }

    // Construct the update payload with only changed fields by comparing against old record
    const updatePayload = {};
    const currentData = existingRecord;
    // Loop through formData and compare with currentData
    for (const key in formData) {
      // Skip the memorial_id field
      if (key === 'memorial_id') {
        continue;
      }

      if (formData[key] === '' || formData[key] === undefined || formData[key] === null) {
        updatePayload[key] = null;
      } else {
        updatePayload[key] = formData[key];
      }

      // Check if the field exists in currentData and if it has changed
      if (currentData[key] !== formData[key] && key !== 'memorial_id') {
        // Add to update payload
        updatePayload[key] = formData[key];
      }

      // If the field is a number and is NaN, set it to null in the update payload
      if (typeof formData[key] === 'number' && isNaN(formData[key])) {
        updatePayload[key] = null;
      }
    }

    console.log('Update payload:', updatePayload);

    if (Object.keys(updatePayload).length === 0) {
      return { message: 'No fields were changed', data: currentData };
    }

    // Perform the update with the constructed payload

    const { data, error: updateError } = await supabase
      .from(tableName)
      .update(updatePayload)
      .eq('memorial_id', memorial_id);

    if (updateError) {
      console.error('Error updating record:', updateError);
      throw new Error('Failed to update the record. Please try again.');
    }

    return data;
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
    //Try to update the database (see function definition)
    await updateRecordInSupabase(supabase, formData);

    //If it worked, show the record ID to the user
    const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
    const html = await ejs.renderFile(templatePath, { record: null, message: `Record ${memorial_id} has been updated successfully.` });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  } catch (error) {

    //If it didn't work, show a friendly error message to the user.
    console.error('Error updating record:', error);
    const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
    const html = await ejs.renderFile(templatePath, { record: null, message: 'Error Updating Record. Please try again.' });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  }
};
