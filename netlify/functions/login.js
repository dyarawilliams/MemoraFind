const ejs = require('ejs');
const path = require('path');
const querystring = require('querystring');
const {
  authConfigured,
  verifyPassword,
  identityOk,
  isLocked,
  registerFailure,
  clearFailures,
  failureCookieForCurrent,
  establishSession,
  renderLogin,
  htmlResponse
} = require('./adminSession');

const LOGIN_FAILED = 'Login failed. Please try again or contact a library administrator.';
const LOCKED_OUT = 'Too many attempts. Please wait 15 minutes and try again.';

function postedIdentity(parsed) {
  const value = parsed.username || parsed.email || '';
  if (Array.isArray(value)) return value.join(',');
  return String(value || '');
}

async function handleLogin(event) {
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return renderLogin(null, 405);
  }

  if (!authConfigured()) {
    console.error('Admin login is not configured. Set ADMIN_EMAIL, ADMIN_SESSION_SECRET (16+ characters), and ADMIN_PASSWORD or ADMIN_PASSWORD_HASH.');
    return renderLogin(LOGIN_FAILED, 500);
  }

  if (isLocked(event)) {
    return renderLogin(LOCKED_OUT, 429, [failureCookieForCurrent(event)]);
  }

  const parsed = querystring.parse(event.body || '');
  const password = typeof parsed.password === 'string' ? parsed.password : '';
  // Always check both so a wrong identity does not skip the password work.
  const emailOk = identityOk(postedIdentity(parsed));
  const passwordOk = await verifyPassword(password);

  if (!emailOk || !passwordOk) {
    const failure = registerFailure(event);
    return renderLogin(failure.locked ? LOCKED_OUT : LOGIN_FAILED, failure.locked ? 429 : 401, [failure.cookie]);
  }

  const issued = establishSession();
  if (!issued) {
    console.error('Admin session could not be signed.');
    return renderLogin(LOGIN_FAILED, 500);
  }

  const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
  const html = await ejs.renderFile(templatePath, { record: null, message: null });
  return htmlResponse(200, html, [issued.cookie, clearFailures(event)]);
}

exports.handler = async function (event) {
  try {
    return await handleLogin(event || {});
  } catch (error) {
    console.error('Login failed', error && error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
      body: 'Internal Server Error'
    };
  }
};
