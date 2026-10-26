const ejs = require('ejs');
const path = require('path');
const { requireAdmin } = require('./adminSession');

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
    console.error('Error rendering template:', error.message);
    return {
      statusCode: 500,
      headers: { 'Cache-Control': 'no-store' },
      body: 'Internal Server Error'
    };
  }
};
