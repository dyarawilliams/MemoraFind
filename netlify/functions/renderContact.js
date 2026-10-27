const ejs = require('ejs');
const path = require('path');

exports.handler = async (event, context) => {
  try {

    // Retrieve page and render it as HTML
    const templatePath = path.resolve(__dirname, '../../public/views/contact.ejs');
    const html = await ejs.renderFile(templatePath, {});

    // Return page from function
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };

    // Handle failure
  } catch (error) {
    console.error('Error rendering contact.ejs:', error.message);
    return {
      statusCode: 500,
      body: 'Internal Server Error'
    };
  }
};
