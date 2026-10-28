/*
 * Browser errors. The footer script posts window.onerror and
 * unhandledrejection here. The body is size-capped, fields outside the
 * allowlist are dropped, and the rate limit is per client address in this
 * isolate — the same best-effort shape as the admin lockout, not a shared
 * counter. A hit is one structured line from errorReport.js. No row is
 * written and no request body is stored.
 *
 * This is a route: /.netlify/functions/logClientError. robots.txt disallows
 * it. It is not a page a person opens.
 */

'use strict';

const crypto = require('crypto');
const { logError } = require('./errorReport');

const MAX_BODY_BYTES = 4096;
const MAX_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED = 5000;

const hits = new Map();

function headerValue(event, name) {
  const headers = (event && event.headers) || {};
  const wanted = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === wanted) return String(headers[keys[i]] || '');
  }
  return '';
}

function clientAddress(event) {
  const netlifyIp = headerValue(event, 'x-nf-client-connection-ip') || headerValue(event, 'client-ip');
  const trimmed = String(netlifyIp || '').trim();
  if (trimmed) return trimmed;
  const forwarded = headerValue(event, 'x-forwarded-for').split(',')[0].trim();
  return forwarded || 'unknown';
}

function clientKey(event) {
  return crypto.createHash('sha256').update(clientAddress(event)).digest('hex');
}

function prune(now) {
  if (hits.size < MAX_TRACKED) return;
  hits.forEach(function (entry, key) {
    if (now - entry.start >= WINDOW_MS) hits.delete(key);
  });
}

function rateLimited(event) {
  const now = Date.now();
  prune(now);
  const key = clientKey(event);
  let entry = hits.get(key);
  if (!entry || now - entry.start >= WINDOW_MS) {
    entry = { start: now, count: 0 };
    hits.set(key, entry);
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function rawBody(event) {
  const body = event && typeof event.body === 'string' ? event.body : '';
  if (event && event.isBase64Encoded) {
    try {
      return Buffer.from(body, 'base64').toString('utf8');
    } catch (error) {
      return '';
    }
  }
  return body;
}

function clip(value, max) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.length > max ? text.slice(0, max) : text;
}

function pagePath(value) {
  let path = clip(value, 200);
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);
  if (!path || path.charAt(0) !== '/') return '';
  return path;
}

function plain(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    },
    body: body
  };
}

exports.handler = async function (event) {
  const method = event && event.httpMethod ? String(event.httpMethod).toUpperCase() : 'GET';
  if (method !== 'POST') return plain(405, 'Method not allowed\n');
  if (rateLimited(event || {})) return plain(429, 'Too many reports. Please try again later.\n');

  const body = rawBody(event);
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return plain(413, 'Report too large\n');

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    return plain(400, 'Report could not be read\n');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return plain(400, 'Report could not be read\n');
  }

  const kind = payload.kind === 'unhandledrejection' ? 'unhandledrejection' : 'error';
  const message = clip(payload.message, 500);
  const stack = clip(payload.stack, 1500);
  if (!message && !stack) return plain(204, '');

  const path = pagePath(payload.path);
  await logError({
    functionName: 'logClientError',
    path: path,
    message: kind + ': ' + message,
    stack: stack
  });
  return plain(204, '');
};

function resetClientErrorLogForTests() {
  hits.clear();
}

exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
exports.MAX_PER_WINDOW = MAX_PER_WINDOW;
exports.resetClientErrorLogForTests = resetClientErrorLogForTests;
