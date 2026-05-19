const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');

const SERVERS_DIR = process.env.SERVERS_DIR || '/opt/kroxy/servers';

// Helper: resolve safe path inside server dir
function safePath(serverDir, reqPath) {
  const base = path.resolve(serverDir);
  const target = path.resolve(path.join(serverDir, reqPath || '/'));
  if (!target.startsWith(base)) return null; // path traversal guard
  return target;
}

// File Manager page
router.get('/:id/files', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) { req.flash('error', 'Server not found.'); return res.redirect('/servers'); }
  const reqPath = req.query.path || '/';
  const serverDir = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, reqPath);
  if (!targetPath) { req.flash('error', 'Invalid path.'); return res.redirect(`/servers/${server._id}/files`); }

  let entries = [];
  let error = null;
  try {
    if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true });
    const items = fs.readdirSync(targetPath, { withFileTypes: true });
    entries = items.map(item => {
      const fullPath = path.join(targetPath, item.name);
      let size = 0;
      try { size = item.isFile() ? fs.statSync(fullPath).size : 0; } catch(e) {}
      return {
        name: item.name,
        isDir: item.isDirectory(),
        size,
        path: path.join(reqPath, item.name).replace(/\\/g, '/'),
      };
    }).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  } catch(e) { error = e.message; }

  // Breadcrumb parts
  const parts = reqPath.split('/').filter(Boolean);
  const breadcrumbs = [{ name: 'root', path: '/' }];
  let cumPath = '';
  for (const p of parts) { cumPath += '/' + p; breadcrumbs.push({ name: p, path: cumPath }); }

  res.render('servers/files', {
    pageTitle: `Files — ${server.name}`,
    layout: 'main',
    server, entries, breadcrumbs,
    currentPath: reqPath, error,
  });
});

// View / Edit file
router.get('/:id/files/edit', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.redirect('/servers');
  const serverDir = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.query.path);
  if (!targetPath) return res.redirect(`/servers/${server._id}/files`);

  const EDITABLE = ['.txt','.json','.yml','.yaml','.properties','.cfg','.conf','.log','.sh','.env','.toml','.xml'];
  const ext = path.extname(targetPath).toLowerCase();
  if (!EDITABLE.includes(ext)) {
    req.flash('error', 'This file type cannot be edited in the browser.');
    return res.redirect(`/servers/${server._id}/files?path=${path.dirname(req.query.path)}`);
  }

  let content = '';
  try { content = fs.readFileSync(targetPath, 'utf8'); } catch(e) { content = ''; }

  res.render('servers/edit', {
    pageTitle: `Edit ${path.basename(targetPath)} — ${server.name}`,
    layout: 'main',
    server, content,
    filePath: req.query.path,
    fileName: path.basename(targetPath),
  });
});

// Save file
router.post('/:id/files/edit', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.body.path);
  if (!targetPath) return res.json({ success: false, message: 'Invalid path' });
  try {
    fs.writeFileSync(targetPath, req.body.content, 'utf8');
    return res.json({ success: true });
  } catch(e) { return res.json({ success: false, message: e.message }); }
});

// Delete file/folder
router.post('/:id/files/delete', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.body.path);
  if (!targetPath || targetPath === path.resolve(serverDir)) return res.json({ success: false, message: 'Cannot delete root' });
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true });
    else fs.unlinkSync(targetPath);
    return res.json({ success: true });
  } catch(e) { return res.json({ success: false, message: e.message }); }
});

// Create folder
router.post('/:id/files/mkdir', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, path.join(req.body.path, req.body.name));
  if (!targetPath) return res.json({ success: false });
  try { fs.mkdirSync(targetPath, { recursive: true }); return res.json({ success: true }); }
  catch(e) { return res.json({ success: false, message: e.message }); }
});

// Download file
router.get('/:id/files/download', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.status(404).end();
  const serverDir = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.query.path);
  if (!targetPath || !fs.existsSync(targetPath)) return res.status(404).end();
  res.download(targetPath);
});

// Upload file
router.post('/:id/files/upload', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir = path.join(SERVERS_DIR, server._id.toString());
  const uploadDir = safePath(serverDir, req.body.path || '/');
  if (!uploadDir) return res.json({ success: false });

  // Use busboy for streaming upload
  const busboy = require('busboy');
  const bb = busboy({ headers: req.headers });
  const uploads = [];

  bb.on('file', (name, file, info) => {
    const saveTo = path.join(uploadDir, info.filename);
    const stream = fs.createWriteStream(saveTo);
    file.pipe(stream);
    uploads.push(info.filename);
  });

  bb.on('close', () => res.json({ success: true, uploaded: uploads }));
  bb.on('error', (e) => res.json({ success: false, message: e.message }));
  req.pipe(bb);
});

module.exports = router;
