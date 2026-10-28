const ejs = require('ejs');
const path = require('path');
const { friendlyError } = require('./errorReport');

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
    return friendlyError({
      functionName: 'renderContact',
      event: event,
      error: error,
      message: 'Error rendering contact.ejs'
    });
  }
};
