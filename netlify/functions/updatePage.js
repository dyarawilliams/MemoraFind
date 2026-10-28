const ejs = require('ejs');
const path = require('path');
const { requireAdmin } = require('./adminSession');
const { friendlyError } = require('./errorReport');

exports.handler = async function (event) {
  try {
    const gate = await requireAdmin(event || {}, 200);
    if (gate.response) return gate.response;

    const templatePath = path.resolve(__dirname, '../../public/views/update.ejs');
    const html = await ejs.renderFile(templatePath, { record: null, message: null });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store'
      },
      body: html
    };
  } catch (error) {
    return friendlyError({
      functionName: 'updatePage',
      event: event,
      error: error,
      message: 'Error rendering template'
    });
  }
};
