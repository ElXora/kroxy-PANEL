const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const db = require('./db');
const ejsLayouts = require('./ejsLayouts');
const authRoutes      = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const serverRoutes    = require('./routes/servers');
const adminRoutes     = require('./routes/admin');
const nodesRoutes     = require('./routes/nodes');
const apiRoutes       = require('./routes/api');
const fileRoutes      = require('./routes/filemanager');
const storeRoutes     = require('./routes/store');
const afkRoutes       = require('./routes/afk');
const redeemRoutes    = require('./routes/redeem');
const dailyRoutes     = require('./routes/daily');
const { requireAuth } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

// WebSocket for live console
const wss = new WebSocket.Server({ server, path: '/ws/console' });
require('./services/websocket')(wss);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
ejsLayouts(app);

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.json({ limit: '100mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'kroxy-super-secret-2024',
  resave: false,
  saveUninitialized: false,
  name: 'kroxy_session',
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(flash());

// Locals
app.use(async (req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error   = req.flash('error');
  res.locals.user    = null;
  if (req.session.userId) {
    try { res.locals.user = await db.users.findOne({ _id: req.session.userId }); } catch (e) {}
  }
  next();
});

// Routes
app.use('/',           authRoutes);
app.use('/dashboard',  requireAuth, dashboardRoutes);
app.use('/servers',    requireAuth, serverRoutes);
app.use('/servers',    requireAuth, fileRoutes);   // file manager under /servers/:id/files
app.use('/admin',      requireAuth, adminRoutes);
app.use('/admin/nodes',requireAuth, nodesRoutes);
app.use('/api',        requireAuth, apiRoutes);
app.use('/store',      requireAuth, storeRoutes);
app.use('/afk',        requireAuth, afkRoutes);
app.use('/redeem',     requireAuth, redeemRoutes);
app.use('/daily',      requireAuth, dailyRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('errors/404', { pageTitle: '404 Not Found', layout: 'main' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\x1b[32m✓ Kroxy Panel running on http://localhost:${PORT}\x1b[0m`);
  console.log(`\x1b[90m  Default login: admin / admin123\x1b[0m`);
});
