/**
 * EJS doesn't have built-in layout support. We use this middleware
 * to wrap all rendered views inside their layout templates.
 */
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');

function ejsLayouts(app) {
  const originalRender = app.response.render;

  app.response.render = function (view, options, callback) {
    const res = this;
    const req = res.req;

    // Merge locals
    const data = Object.assign({}, res.locals, options || {});

    // Determine layout
    const layout = data.layout !== undefined ? data.layout : 'main';

    if (!layout) {
      return originalRender.call(res, view, data, callback);
    }

    const viewsDir = app.get('views');
    const viewFile = path.join(viewsDir, view + '.ejs');
    const layoutFile = path.join(viewsDir, 'layouts', layout + '.ejs');

    // Render view first
    ejs.renderFile(viewFile, data, { views: viewsDir }, (err, content) => {
      if (err) {
        if (callback) return callback(err);
        return res.status(500).send('View render error: ' + err.message);
      }

      // Inject content into layout
      data.content = content;

      ejs.renderFile(layoutFile, data, { views: viewsDir }, (err2, html) => {
        if (err2) {
          if (callback) return callback(err2);
          return res.status(500).send('Layout render error: ' + err2.message);
        }

        if (callback) return callback(null, html);
        res.send(html);
      });
    });
  };
}

module.exports = ejsLayouts;
