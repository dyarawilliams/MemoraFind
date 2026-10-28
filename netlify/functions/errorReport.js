/*
 * Structured error reporting for the Netlify functions.
 *
 * This file exports no handler. Netlify does not route it, the same way it
 * leaves baseRecord.js and adminSession.js unrouted. Callers log one JSON
 * line (function name, path, message, stack, timestamp) and, when they are
 * answering a visitor, return the shared friendly page in public/views/error.ejs.
 *
 * Nothing here records a request body, a cookie, or an environment value.
 * Messages and stacks are scrubbed of the secrets this site keeps in the
 * environment before they are written. Sentry is optional: a report is sent
 * only when SENTRY_DSN is set to a usable https DSN, and the send is a no-op
 * otherwise. No Sentry SDK is loaded, so an unset variable adds no dependency
 * and no account.
 */

'use strict';

const https = require('https');
const crypto = require('crypto');
const ejs = require('ejs');
const path = require('path');

const SECRET_ENV_NAMES = [
  'SUPABASE_API_KEY',
  'ADMIN_PASSWORD',
  'SUPABASE_ADMIN_PASSWORD',
  'ADMIN_SESSION_SECRET',
  'ADMIN_PASSWORD_HASH',
  'SENTRY_DSN'
];

const SECRET_ASSIGNMENT = /((?:password|passwd|secret|api[_-]?key|authorization|cookie|set-cookie|token|dsn)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;

let transport = postSentryEnvelope;
let inflight = Promise.resolve();

function secretValues() {
  const values = [];
  for (let i = 0; i < SECRET_ENV_NAMES.length; i += 1) {
    const value = process.env[SECRET_ENV_NAMES[i]];
    if (typeof value === 'string' && value.length >= 4) values.push(value);
  }
  return values;
}

function redact(value) {
  let text = value === null || value === undefined ? '' : String(value);
  const secrets = secretValues();
  for (let i = 0; i < secrets.length; i += 1) {
    if (text.indexOf(secrets[i]) !== -1) text = text.split(secrets[i]).join('[redacted]');
  }
  return text.replace(SECRET_ASSIGNMENT, '$1[redacted]').replace(BEARER, 'Bearer [redacted]');
}

function errorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error && error.message) return String(error.message);
  return '';
}

function errorStack(error) {
  if (error && typeof error.stack === 'string') return error.stack;
  return '';
}

function safePath(event, explicitPath) {
  let value = explicitPath;
  if (!value && event) value = event.path || event.rawPath || event.rawUrl || '';
  value = String(value || '');
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
  const cut = value.search(/[?#]/);
  if (cut !== -1) value = value.slice(0, cut);
  if (value.length > 200) value = value.slice(0, 200);
  return value;
}

function buildEntry(details) {
  const input = details || {};
  const provided = input.message ? String(input.message) : '';
  const fromError = errorText(input.error);
  let message = provided;
  if (fromError && fromError !== provided) message = provided ? provided + ': ' + fromError : fromError;
  message = redact(message || 'Unknown error').slice(0, 1000);
  const stackText = redact(input.stack || errorStack(input.error)).slice(0, 4000);
  return {
    level: 'error',
    function: String(input.functionName || 'unknown').slice(0, 80),
    path: safePath(input.event, input.path),
    message: message,
    stack: stackText ? stackText : null,
    timestamp: new Date().toISOString()
  };
}

function sentryDsn() {
  const value = process.env.SENTRY_DSN;
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed;
}

function parseSentryDsn(dsn) {
  let url;
  try {
    url = new URL(dsn);
  } catch (error) {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const publicKey = decodeURIComponent(url.username || '');
  const projectId = url.pathname.replace(/^\/+/, '').split('/')[0];
  if (!publicKey || !/^\d+$/.test(projectId) || !url.hostname) return null;
  return {
    publicKey: publicKey,
    projectId: projectId,
    host: url.host
  };
}

function sentryEventId() {
  return crypto.randomBytes(16).toString('hex');
}

function sentryEnvelope(entry) {
  const eventId = sentryEventId();
  const header = JSON.stringify({
    event_id: eventId,
    sent_at: entry.timestamp
  });
  const itemHeader = JSON.stringify({ type: 'event' });
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    message: { formatted: entry.message },
    tags: { function: entry.function },
    extra: {
      path: entry.path,
      stack: entry.stack
    }
  };
  return header + '\n' + itemHeader + '\n' + JSON.stringify(event) + '\n';
}

function postSentryEnvelope(target) {
  return new Promise(function (resolve, reject) {
    const request = https.request({
      hostname: target.hostname,
      port: target.port,
      path: target.path,
      method: 'POST',
      headers: target.headers,
      timeout: 1500
    }, function (response) {
      response.resume();
      if (response.statusCode >= 200 && response.statusCode < 300) {
        resolve();
        return;
      }
      reject(new Error('Sentry responded ' + response.statusCode));
    });
    request.on('error', reject);
    request.on('timeout', function () {
      request.destroy();
      reject(new Error('Sentry request timed out'));
    });
    request.end(target.body);
  });
}

function track(promise) {
  const settled = Promise.resolve(promise).then(function () {}, function () {});
  inflight = Promise.all([inflight, settled]).then(function () {}, function () {});
  return settled;
}

async function notifySentry(entry) {
  const dsn = sentryDsn();
  if (!dsn) return;
  const parsed = parseSentryDsn(dsn);
  if (!parsed) {
    console.error(JSON.stringify({
      level: 'error',
      function: 'errorReport',
      path: '',
      message: 'SENTRY_DSN is set but is not a usable https DSN',
      stack: null,
      timestamp: new Date().toISOString()
    }));
    return;
  }
  const body = sentryEnvelope(entry);
  const target = {
    hostname: parsed.host.split(':')[0],
    port: parsed.host.indexOf(':') === -1 ? 443 : Number(parsed.host.split(':')[1]),
    path: '/api/' + parsed.projectId + '/envelope/',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'Content-Length': Buffer.byteLength(body),
      'X-Sentry-Auth': 'Sentry sentry_version=7, sentry_client=memorafind-error-report/1.0, sentry_key=' + parsed.publicKey
    },
    body: body
  };
  try {
    await transport(target);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      function: 'errorReport',
      path: '',
      message: 'Sentry report failed',
      stack: redact(errorText(error)) || null,
      timestamp: new Date().toISOString()
    }));
  }
}

/*
 * Write one structured line and start a Sentry delivery when SENTRY_DSN is
 * set. The console line is synchronous so a caller that then throws has
 * already logged. Await logError (or flushErrorReporting) before returning
 * a response when the delivery should finish first.
 */
function reportError(details) {
  const entry = buildEntry(details);
  console.error(JSON.stringify(entry));
  track(notifySentry(entry));
  return entry;
}

function logError(details) {
  const entry = reportError(details);
  return flushErrorReporting().then(function () {
    return entry;
  });
}

function flushErrorReporting() {
  return inflight;
}

const FRIENDLY_PLAIN = 'Something went wrong. Please try again shortly.\n';

async function friendlyError(details) {
  const input = details || {};
  await logError({
    functionName: input.functionName,
    event: input.event,
    path: input.path,
    error: input.error,
    message: input.message,
    stack: input.stack
  });
  const statusCode = input.statusCode || 500;
  try {
    const templatePath = path.resolve(__dirname, '../../public/views/error.ejs');
    const html = await ejs.renderFile(templatePath, {});
    return {
      statusCode: statusCode,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow'
      },
      body: html
    };
  } catch (renderError) {
    reportError({
      functionName: input.functionName || 'errorReport',
      message: 'The friendly error page could not be rendered',
      error: renderError
    });
    await flushErrorReporting();
    return {
      statusCode: statusCode,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow'
      },
      body: FRIENDLY_PLAIN
    };
  }
}

function setSentryTransportForTests(next) {
  transport = typeof next === 'function' ? next : postSentryEnvelope;
}

function resetErrorReportingForTests() {
  transport = postSentryEnvelope;
  inflight = Promise.resolve();
}

module.exports = {
  redact: redact,
  reportError: reportError,
  logError: logError,
  flushErrorReporting: flushErrorReporting,
  friendlyError: friendlyError,
  parseSentryDsn: parseSentryDsn,
  setSentryTransportForTests: setSentryTransportForTests,
  resetErrorReportingForTests: resetErrorReportingForTests
};
