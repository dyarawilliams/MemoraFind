const ejs = require('ejs');
const path = require('path');

exports.handler = async (event, context) => {
  try {

    // Retrieve page and render it as HTML
    const templatePath = path.resolve(__dirname, '../../public/views/index.ejs');
    const html = await ejs.renderFile(templatePath, { records: null });

    // Return page from function
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };

    // Handle failure
  } catch (error) {
    console.error('Error rendering index.ejs:', error.message);
    return {
      statusCode: 500,
      body: 'Internal Server Error'
    };
  }
};