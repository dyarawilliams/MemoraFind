const crypto = require('crypto');
const ejs = require('ejs');
const path = require('path');

/*
 * Administrator session and lockout.
 *
 * The login form posts a password and nothing else. The password is checked
 * here, against ADMIN_PASSWORD_HASH (scrypt) when that is set, otherwise
 * against ADMIN_PASSWORD. The comparison is constant-time. A matching
 * password is not a Supabase session: the cookie is an HMAC we sign with
 * ADMIN_SESSION_SECRET, so a copied Supabase access token is not a login.
 *
 * Lockout is best-effort, and it does not use a new table. Serverless
 * isolates do not share memory, so a counter that lived only in this process
 * would reset whenever Netlify started a fresh isolate. Two copies are kept
 * and the stricter one wins:
 *
 *   - a per-client-address counter in this isolate's memory
 *   - a signed mf_fail cookie the browser sends back
 *
 * Five failures lock that client out for 15 minutes. A new isolate starts
 * with an empty memory counter, and a caller that drops the cookie avoids
 * the copy it was holding, so this slows guessing rather than promising a
 * hard account lock. A Supabase table would survive both, and it was not
 * added: that would be a schema change. Logout clears the session cookie
 * with the same attributes it was set with and forgets that session id in
 * this isolate's memory. A restarted isolate will not remember the logout;
 * the cookie on the browser is already gone, and a copy of it works only
 * until it expires (ten minutes) and only in an isolate that did not see
 * the logout.
 */

const SESSION_COOKIE_NAME = 'mf_session';
const FAIL_COOKIE_NAME = 'mf_fail';
const SESSION_TTL_SECONDS = 600;
const FAILURE_LIMIT = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const FAIL_COOKIE_TTL_SECONDS = 15 * 60;
const MIN_SECRET_LENGTH = 16;

const failures = new Map();
const revoked = new Map();

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  if (secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

function authConfigured() {
  const email = String(process.env.ADMIN_EMAIL || '').trim();
  const hash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  const plain = process.env.ADMIN_PASSWORD || '';
  return email.length > 0 && sessionSecret() !== null && (hash.length > 0 || String(plain).length > 0);
}

function timingSafeEqualString(left, right) {
  const a = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function safeEqual(expected, actual) {
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(actual));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function signBody(body) {
  const secret = sessionSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function issueToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signBody(body);
  if (!signature) return null;
  return body + '.' + signature;
}

function readToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = signBody(body);
  if (!expected || !safeEqual(expected, signature)) return null;
  try {
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!json || typeof json !== 'object') return null;
    return json;
  } catch (error) {
    return null;
  }
}

function headerValue(event, name) {
  if (!event || !event.headers) return '';
  const headers = event.headers;
  const wanted = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() !== wanted) continue;
    const value = headers[keys[i]];
    if (Array.isArray(value)) return value.join('; ');
    return value == null ? '' : String(value);
  }
  return '';
}

function parseCookies(header) {
  const out = Object.create(null);
  String(header || '').split(';').forEach(function (part) {
    const text = part.trim();
    if (!text) return;
    const eq = text.indexOf('=');
    if (eq <= 0) return;
    const name = text.slice(0, eq).trim();
    const value = text.slice(eq + 1).trim();
    if (name) out[name] = value;
  });
  return out;
}

function serializeCookie(name, value, maxAgeSeconds) {
  const maxAge = maxAgeSeconds > 0 ? Math.floor(maxAgeSeconds) : 0;
  const expires = maxAge > 0
    ? new Date(Date.now() + maxAge * 1000).toUTCString()
    : 'Thu, 01 Jan 1970 00:00:00 GMT';
  return [
    name + '=' + value,
    'Max-Age=' + String(maxAge),
    'Expires=' + expires,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict'
  ].join('; ');
}

function clearLegacyTokenCookie() {
  // The previous login stored a Supabase access token under this name,
  // without Secure. Clear it with the attributes it was set with.
  return [
    'token=',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ].join('; ');
}

function htmlResponse(statusCode, html, cookies) {
  const response = {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store'
    },
    body: html
  };
  const list = (cookies || []).filter(function (cookie) {
    return typeof cookie === 'string' && cookie.length > 0;
  });
  if (list.length > 0) {
    response.multiValueHeaders = { 'Set-Cookie': list };
  }
  return response;
}

async function renderLogin(message, statusCode, cookies) {
  const templatePath = path.resolve(__dirname, '../../public/views/login.ejs');
  const html = await ejs.renderFile(templatePath, { message: message || null });
  return htmlResponse(statusCode, html, cookies);
}

function adminEmail() {
  return String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

function identityOk(posted) {
  const given = String(posted || '').trim();
  if (!given) return true;
  const email = adminEmail();
  if (!email) return false;
  return timingSafeEqualString(given.toLowerCase(), email);
}

async function verifyScrypt(password, stored) {
  const match = /^scrypt:([0-9a-f]+):([0-9a-f]+)$/i.exec(String(stored || '').trim());
  if (!match) return false;
  const salt = Buffer.from(match[1], 'hex');
  const expected = Buffer.from(match[2], 'hex');
  if (salt.length < 16 || expected.length < 16) return false;
  if (match[1].length !== salt.length * 2 || match[2].length !== expected.length * 2) return false;
  try {
    const actual = await new Promise(function (resolve, reject) {
      crypto.scrypt(password, salt, expected.length, function (error, key) {
        if (error) reject(error);
        else resolve(key);
      });
    });
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch (error) {
    console.error('Password hash check failed');
    return false;
  }
}

async function verifyPassword(password) {
  const candidate = typeof password === 'string' ? password : '';
  if (candidate.length > 256) return false;
  const hash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  if (hash) return verifyScrypt(candidate, hash);
  const plain = process.env.ADMIN_PASSWORD;
  if (typeof plain === 'string' && plain.length > 0) {
    return timingSafeEqualString(candidate, plain);
  }
  return false;
}

function clientAddress(event) {
  const netlifyIp = headerValue(event, 'x-nf-client-connection-ip') || headerValue(event, 'client-ip');
  const trimmed = String(netlifyIp || '').trim();
  if (trimmed) return trimmed;
  const forwarded = headerValue(event, 'x-forwarded-for').split(',')[0].trim();
  return forwarded || 'unknown';
}

function clientKeyId(event) {
  return crypto.createHash('sha256').update(clientAddress(event)).digest('hex');
}

function prune(now) {
  failures.forEach(function (entry, key) {
    const age = now - entry.updatedAt;
    if (entry.lockedUntil <= now && age > LOCKOUT_MS) failures.delete(key);
  });
  revoked.forEach(function (expMs, jti) {
    if (expMs <= now) revoked.delete(jti);
  });
}

function readFailureCookie(event) {
  const cookies = parseCookies(headerValue(event, 'cookie'));
  const payload = readToken(cookies[FAIL_COOKIE_NAME]);
  if (!payload || payload.kind !== 'fail' || payload.v !== 1) return null;
  const count = Number(payload.c);
  const lockedUntil = Number(payload.u);
  if (!Number.isFinite(count) || !Number.isFinite(lockedUntil)) return null;
  return { count: count, lockedUntil: lockedUntil };
}

function failureCookie(count, lockedUntil) {
  const token = issueToken({
    v: 1,
    kind: 'fail',
    c: count,
    u: lockedUntil
  });
  if (!token) return '';
  return serializeCookie(FAIL_COOKIE_NAME, token, FAIL_COOKIE_TTL_SECONDS);
}

function combinedFailure(event) {
  const memory = failures.get(clientKeyId(event)) || { count: 0, lockedUntil: 0 };
  const fromCookie = readFailureCookie(event);
  return {
    count: Math.max(memory.count, fromCookie ? fromCookie.count : 0),
    lockedUntil: Math.max(memory.lockedUntil || 0, fromCookie ? fromCookie.lockedUntil || 0 : 0)
  };
}

function isLocked(event) {
  prune(Date.now());
  return combinedFailure(event).lockedUntil > Date.now();
}

function failureCookieForCurrent(event) {
  const state = combinedFailure(event);
  return failureCookie(state.count, state.lockedUntil);
}

function registerFailure(event) {
  const now = Date.now();
  prune(now);
  const state = combinedFailure(event);
  let count = state.count + 1;
  let lockedUntil = state.lockedUntil;
  if (count >= FAILURE_LIMIT) {
    count = FAILURE_LIMIT;
    lockedUntil = now + LOCKOUT_MS;
  }
  failures.set(clientKeyId(event), { count: count, lockedUntil: lockedUntil, updatedAt: now });
  return {
    locked: lockedUntil > now,
    cookie: failureCookie(count, lockedUntil)
  };
}

function clearFailures(event) {
  failures.delete(clientKeyId(event));
  return serializeCookie(FAIL_COOKIE_NAME, '', 0);
}

function establishSession() {
  const email = adminEmail();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    kind: 'session',
    sub: email,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: crypto.randomBytes(16).toString('hex')
  };
  const token = issueToken(payload);
  if (!token) return null;
  return {
    session: payload,
    cookie: serializeCookie(SESSION_COOKIE_NAME, token, SESSION_TTL_SECONDS)
  };
}

function readSession(event) {
  prune(Date.now());
  const cookies = parseCookies(headerValue(event, 'cookie'));
  const payload = readToken(cookies[SESSION_COOKIE_NAME]);
  if (!payload || payload.kind !== 'session' || payload.v !== 1) return null;
  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') return null;
  const email = adminEmail();
  if (!email || !timingSafeEqualString(payload.sub, email)) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
  if (revoked.has(payload.jti)) return null;
  return payload;
}

function revokeSession(session) {
  if (!session || typeof session.jti !== 'string') return;
  const expMs = typeof session.exp === 'number'
    ? session.exp * 1000
    : Date.now() + SESSION_TTL_SECONDS * 1000;
  revoked.set(session.jti, expMs);
}

function clearSessionCookies() {
  return [
    serializeCookie(SESSION_COOKIE_NAME, '', 0),
    clearLegacyTokenCookie()
  ];
}

async function requireAdmin(event, deniedStatus) {
  const session = readSession(event);
  if (session) return { session: session, response: null };
  const response = await renderLogin(
    'Session has timed out. Please log in again.',
    deniedStatus || 401
  );
  return { session: null, response: response };
}

function resetAuthStateForTests() {
  failures.clear();
  revoked.clear();
}

module.exports = {
  SESSION_COOKIE_NAME,
  FAIL_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  FAILURE_LIMIT,
  LOCKOUT_MS,
  authConfigured,
  verifyPassword,
  identityOk,
  isLocked,
  registerFailure,
  clearFailures,
  failureCookieForCurrent,
  establishSession,
  readSession,
  revokeSession,
  clearSessionCookies,
  requireAdmin,
  renderLogin,
  htmlResponse,
  resetAuthStateForTests
};
