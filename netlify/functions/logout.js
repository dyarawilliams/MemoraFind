const { readSession, revokeSession, clearSessionCookies } = require('./adminSession');

exports.handler = async function (event) {
  const session = readSession(event || {});
  if (session) revokeSession(session);

  return {
    statusCode: 302,
    headers: {
      Location: '/',
      'Cache-Control': 'no-store'
    },
    multiValueHeaders: {
      'Set-Cookie': clearSessionCookies()
    },
    body: 'Redirecting...'
  };
};
