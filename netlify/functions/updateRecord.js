const { createClient } = require('@supabase/supabase-js');
const ejs = require('ejs');
const path = require('path');
const querystring = require('querystring');
const { findCemetery } = require('./findCemetery');
const { baseTableFor } = require('./baseRecord');
const { requireAdmin } = require('./adminSession');
const { reportError, logError, flushErrorReporting } = require('./errorReport');

//Columns the database holds as numbers. PostgREST hands them back as numbers
//while an HTML form always posts strings, so they have to be compared as
//numbers — compared as strings "1907" never equals 1907 and every submit looked
//like a change to the dates.
const NUMERIC_COLUMNS = ['birth_year', 'birth_day', 'death_year', 'death_day'];

//The edit form's fields, and nothing else. memorial_id is the row to update,
//not a column the form is allowed to change. A posted key that is not in this
//map (notes, prefix, a column the form does not show) is ignored.
const EDITABLE_FIELDS = {
  first_name: { kind: 'text', max: 80, required: true },
  middle_name: { kind: 'text', max: 80 },
  maiden_name: { kind: 'text', max: 80 },
  last_name: { kind: 'text', max: 80, required: true },
  suffix: { kind: 'text', max: 20 },
  is_vet: { kind: 'vet' },
  birth_year: { kind: 'year' },
  birth_month: { kind: 'text', max: 12 },
  birth_day: { kind: 'day' },
  death_year: { kind: 'year' },
  death_month: { kind: 'text', max: 12 },
  death_day: { kind: 'day' },
  section: { kind: 'text', max: 80 },
  lot: { kind: 'text', max: 40 }
};

const MEMORIAL_ID_PATTERN = /^\d{1,12}$/;
const MAX_BODY_LENGTH = 20000;

//An empty form field and an empty column mean the same thing.
function isEmptyValue(value) {
  return value === null || value === undefined || value === '';
}

//The date columns are integers in the database, and the scraper stores 0 in one
//of them when it has nothing to record: the live base table holds a zero in
//death_day for a record whose edit form shows an empty day. No grave is dated
//in day 0, month 0 or year 0, so in these four columns a zero means "nothing
//recorded" in exactly the same way as null, undefined or an empty field — this
//is what the value means, not a numerical fudge. Any zero the column can hand
//back counts (0, '0', ' 0', '0.0'): PostgREST's 0 and the form's '' must land on
//the same side of this test, or an untouched submit looks like a change and
//every save sends a payload that changes nothing.
function isEmptyDateValue(value) {
  if (isEmptyValue(value)) {
    return true;
  }
  return Number(value) === 0;
}

//True when the submitted value genuinely differs from the stored one.
function valueChanged(key, submitted, stored) {
  if (NUMERIC_COLUMNS.indexOf(key) !== -1) {
    if (isEmptyDateValue(submitted) || isEmptyDateValue(stored)) {
      return isEmptyDateValue(submitted) !== isEmptyDateValue(stored);
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

class NothingSavedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NothingSavedError';
  }
}

class FieldValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FieldValidationError';
  }
}

class RecordNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecordNotFoundError';
  }
}

class AdminSignInError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminSignInError';
  }
}

// The three base tables allow UPDATE for the authenticated Supabase user.
// A write with the anon key alone is accepted and changes zero rows, which
// the page used to report as "Nothing was saved". The mf_session cookie still
// gates the admin pages. This sign-in is a separate Supabase Auth session,
// used only for the update, and it never leaves the function: not a cookie,
// not the response, and not the log.
const AUTH_EXPIRY_MARGIN_MS = 60 * 1000;

let cachedAdmin = null;

function supabaseAdminPassword() {
  const dedicated = process.env.SUPABASE_ADMIN_PASSWORD;
  if (typeof dedicated === 'string' && dedicated.length > 0) return dedicated;
  return process.env.ADMIN_PASSWORD || '';
}

function expiryMs(session) {
  const expiresAt = session && Number(session.expires_at);
  if (expiresAt && !isNaN(expiresAt)) return expiresAt * 1000;
  const lifetime = session && Number(session.expires_in);
  const seconds = lifetime && !isNaN(lifetime) ? lifetime : 3600;
  return Date.now() + seconds * 1000;
}

function cacheIsFresh() {
  if (!cachedAdmin || !cachedAdmin.client || !cachedAdmin.expiresAtMs) return false;
  return cachedAdmin.expiresAtMs - Date.now() > AUTH_EXPIRY_MARGIN_MS;
}

function failSignIn() {
  // Do not pass the auth error through. A rejected request can include the
  // password. reportError writes the line before the throw; the handler
  // flushes any optional Sentry delivery before it responds.
  reportError({
    functionName: 'updateRecord',
    path: '/.netlify/functions/updateRecord',
    message: 'Supabase admin sign-in failed'
  });
  throw new AdminSignInError('Supabase admin sign-in failed');
}

async function signInAdminClient() {
  const email = String(process.env.ADMIN_EMAIL || '').trim();
  const password = supabaseAdminPassword();
  if (!email || !password) failSignIn();

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  let result;
  try {
    result = await client.auth.signInWithPassword({
      email: email,
      password: password
    });
  } catch (error) {
    // Do not log `error`. A rejected request can include the password.
    failSignIn();
  }

  const session = result && result.data && result.data.session;
  if (!result || result.error || !session || !session.access_token) failSignIn();

  cachedAdmin = {
    client: client,
    expiresAtMs: expiryMs(session)
  };
  return client;
}

async function refreshCachedAdmin() {
  if (!cachedAdmin || !cachedAdmin.client || !cachedAdmin.client.auth) return false;
  let refreshed;
  try {
    refreshed = await cachedAdmin.client.auth.refreshSession();
  } catch (error) {
    return false;
  }
  const session = refreshed && refreshed.data && refreshed.data.session;
  if (!refreshed || refreshed.error || !session || !session.access_token) return false;
  cachedAdmin.expiresAtMs = expiryMs(session);
  return cacheIsFresh();
}

async function adminClientForSave() {
  if (cacheIsFresh()) return cachedAdmin.client;
  if (cachedAdmin && cachedAdmin.client) {
    const refreshed = await refreshCachedAdmin();
    if (refreshed) return cachedAdmin.client;
    cachedAdmin = null;
  }
  return signInAdminClient();
}

async function replaceAdminClient() {
  if (cachedAdmin && cachedAdmin.client) {
    const refreshed = await refreshCachedAdmin();
    if (refreshed) return cachedAdmin.client;
  }
  cachedAdmin = null;
  return signInAdminClient();
}

function isUnauthorized(error, status) {
  if (status === 401) return true;
  if (!error) return false;
  if (error.status === 401) return true;
  if (String(error.code || '') === 'PGRST301') return true;
  return /jwt expired|invalid jwt/i.test(String(error.message || ''));
}

async function authedQuery(run) {
  const client = await adminClientForSave();
  const first = await run(client);
  if (!isUnauthorized(first && first.error, first && first.status)) return first;
  const recovered = await replaceAdminClient();
  return run(recovered);
}

function resetAdminAuthForTests() {
  cachedAdmin = null;
}

function invalidText(value, max) {
  if (value.length > max) return true;
  return /[\u0000-\u001F\u007F<>]/.test(value);
}

function parseEmptyNumber(value) {
  const text = String(value || '').trim();
  if (text === '' || /^0+$/.test(text)) return { ok: true, empty: true, value: null };
  return { ok: true, empty: false, text: text };
}

function parseField(spec, raw) {
  if (Array.isArray(raw) || typeof raw !== 'string') return { ok: false };
  if (spec.kind === 'vet') {
    const text = raw.trim();
    if (text === '') return { ok: true, value: null };
    if (text === 'Y') return { ok: true, value: 'Y' };
    return { ok: false };
  }
  if (spec.kind === 'text') {
    const text = raw.trim();
    if (text === '') {
      if (spec.required) return { ok: false };
      return { ok: true, value: null };
    }
    if (invalidText(text, spec.max)) return { ok: false };
    return { ok: true, value: text };
  }
  const parsed = parseEmptyNumber(raw);
  if (!parsed.ok) return { ok: false };
  if (parsed.empty) return { ok: true, value: null };
  if (spec.kind === 'day') {
    if (!/^\d{1,2}$/.test(parsed.text)) return { ok: false };
    const day = Number(parsed.text);
    if (day < 1 || day > 31) return { ok: false };
    return { ok: true, value: day };
  }
  if (spec.kind === 'year') {
    if (!/^\d{4}$/.test(parsed.text)) return { ok: false };
    const year = Number(parsed.text);
    if (year < 1700 || year > 2100) return { ok: false };
    return { ok: true, value: year };
  }
  return { ok: false };
}

function editableUpdates(formData) {
  const updates = Object.create(null);
  const names = Object.keys(EDITABLE_FIELDS);
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (!Object.prototype.hasOwnProperty.call(formData, name)) continue;
    const parsed = parseField(EDITABLE_FIELDS[name], formData[name]);
    if (!parsed.ok) return { error: true };
    updates[name] = parsed.value;
  }
  return { error: false, updates: updates };
}

async function updateRecordInSupabase(formData) {
  const memorialId = typeof formData.memorial_id === 'string' ? formData.memorial_id.trim() : '';
  if (!MEMORIAL_ID_PATTERN.test(memorialId)) {
    throw new FieldValidationError('A Memorial ID is a number. The record was not saved.');
  }

  const edited = editableUpdates(formData);
  if (edited.error) {
    throw new FieldValidationError('The record was not saved. One of the fields is missing or not valid.');
  }

  try {
    const cemetery = await findCemetery(memorialId);
    // The view name has to be checked before it is used. Splitting a null
    // cemetery threw, and the handler turned that into a generic save error.
    if (!cemetery) {
      throw new RecordNotFoundError('Memorial ID ' + memorialId + ' was not found in any cemetery.');
    }

    const tableName = baseTableFor(cemetery);
    if (!tableName) {
      await logError({
        functionName: 'updateRecord',
        message: 'Refusing update for unknown cemetery view'
      });
      throw new Error('Invalid table name');
    }

    // The comparison read stays on the anon key. Those selects already
    // succeed; the edit form does too. Signing in is for the write.
    const reader = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);
    const { data: currentData, error: fetchError } = await reader
      .from(tableName)
      .select('*')
      .eq('memorial_id', memorialId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    if (!currentData) {
      throw new RecordNotFoundError('Memorial ID ' + memorialId + ' was not found in ' + tableName + '.');
    }

    const updatePayload = {};
    const names = Object.keys(edited.updates);
    for (let i = 0; i < names.length; i += 1) {
      const key = names[i];
      if (valueChanged(key, edited.updates[key], currentData[key])) {
        updatePayload[key] = edited.updates[key];
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return { fieldsChanged: false, data: currentData, memorialId: memorialId };
    }

    // Ask for the rows the database actually changed. Without .select() the
    // answer carries no rows at all, so a write that no policy permits —
    // Supabase reports that as no error and zero rows — could not be told
    // apart from a real save. select('*') is the whole row: a named column
    // list is what previously rejected reads when a column was absent.
    // This query runs as the signed-in Supabase user. A zero-row result
    // after that sign-in is still "nothing was saved", not a failed sign-in.
    const updated = await authedQuery(function (client) {
      return client
        .from(tableName)
        .update(updatePayload)
        .eq('memorial_id', memorialId)
        .select('*');
    });
    const updatedRows = updated && updated.data;
    const updateError = updated && updated.error;

    if (updateError) {
      await logError({
        functionName: 'updateRecord',
        error: updateError,
        message: 'Error updating record'
      });
      throw new Error('Failed to update the record. Please try again.');
    }

    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      throw new NothingSavedError('The database accepted the update for memorial ID ' + memorialId + ' in ' + tableName + ' but changed no rows.');
    }

    return { fieldsChanged: true, data: updatedRows, memorialId: memorialId };
  } catch (error) {
    if (!error || (error.name !== 'RecordNotFoundError' && error.name !== 'NothingSavedError' && error.name !== 'AdminSignInError')) {
      await logError({
        functionName: 'updateRecord',
        error: error,
        message: 'Error updating record in Supabase'
      });
    }
    throw error;
  }
}

async function renderUpdate(message, statusCode) {
  const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
  const html = await ejs.renderFile(templatePath, { record: null, message: message });
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
    body: html
  };
}

exports.handler = async function (event) {
  const gate = await requireAdmin(event || {}, 401);
  if (gate.response) return gate.response;

  if (event.httpMethod && event.httpMethod !== 'POST') {
    return renderUpdate('The record was not saved.', 405);
  }

  if (event.body && event.body.length > MAX_BODY_LENGTH) {
    return renderUpdate('The record was not saved. One of the fields is missing or not valid.', 400);
  }

  const formData = querystring.parse(event.body || '');

  try {
    const result = await updateRecordInSupabase(formData);
    if (result && result.fieldsChanged === false) {
      return renderUpdate('No fields were changed, so the record was left as it is.', 200);
    }
    return renderUpdate('Record ' + result.memorialId + ' has been updated successfully.', 200);
  } catch (error) {
    if (error && error.name === 'FieldValidationError') {
      return renderUpdate(error.message, 400);
    }

    if (error && error.name === 'RecordNotFoundError') {
      return renderUpdate(error.message, 404);
    }

    if (error && error.name === 'NothingSavedError') {
      await logError({
        functionName: 'updateRecord',
        event: event,
        error: error,
        message: 'Update changed no rows'
      });
      return renderUpdate('Nothing was saved. The database did not change this record. Please check the record is still there, and tell a library administrator if this happens again.', 500);
    }

    if (error && error.name === 'AdminSignInError') {
      await flushErrorReporting();
      return renderUpdate('Error Updating Record. Please try again.', 500);
    }

    await logError({
      functionName: 'updateRecord',
      event: event,
      error: error,
      message: 'Error updating record'
    });
    return renderUpdate('Error Updating Record. Please try again.', 500);
  }
};

exports.resetAdminAuthForTests = resetAdminAuthForTests;
