const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const docker  = require('../services/docker');

const SERVERS_DIR = process.env.SERVERS_DIR || '/opt/kroxy/servers';

function safePath(serverDir, reqPath) {
  const base   = path.resolve(serverDir);
  const target = path.resolve(path.join(serverDir, reqPath || '/'));
  if (!target.startsWith(base)) return null;
  return target;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1048576).toFixed(1)+'MB';
}

// ===== SERVER STATS =====
router.get('/servers/:id/stats', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server || !server.containerId) return res.json({ cpu:0, mem:0, memLimit:0, memPct:0, status: server?.status||'unknown' });
  const [stats, status] = await Promise.all([
    docker.getStats(server.containerId).catch(() => ({ cpu:0, mem:0, memLimit:0, memPct:0 })),
    docker.getStatus(server.containerId).catch(() => 'unknown'),
  ]);
  // Sync status to DB
  if (status !== server.status) {
    await db.servers.update({ _id: server._id }, { $set: { status, updatedAt: new Date() } });
  }
  res.json({ ...stats, status });
});


// Install status — polls until container is ready
router.get('/servers/:id/install-status', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ status: 'error', message: 'Not found' });
  
  let dockerStatus = null;
  if (server.containerId) {
    dockerStatus = await docker.getStatus(server.containerId).catch(() => null);
    if (dockerStatus && dockerStatus !== server.status) {
      await db.servers.update({ _id: server._id }, { $set: { status: dockerStatus } });
      server.status = dockerStatus;
    }
  }
  
  return res.json({
    status:      server.status,
    containerId: server.containerId,
    error:       server.installError || null,
    ready:       !!server.containerId && server.status !== 'installing',
  });
});

// ===== FILE MANAGER API =====
router.get('/servers/:id/files', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ entries: [] });
  const serverDir  = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.query.path || '/');
  if (!targetPath) return res.json({ entries: [] });
  try {
    if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true });
    const items = fs.readdirSync(targetPath, { withFileTypes: true });
    const entries = items.map(item => {
      const full = path.join(targetPath, item.name);
      let size = 0, modified = null;
      try { const st = fs.statSync(full); size = st.size; modified = st.mtime; } catch(e) {}
      return {
        name: item.name,
        isDir: item.isDirectory(),
        size,
        modified,
        path: path.posix.join(req.query.path || '/', item.name),
      };
    }).sort((a,b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    res.json({ entries });
  } catch(e) { res.json({ entries: [], error: e.message }); }
});

router.get('/servers/:id/files/read', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ content: '' });
  const serverDir  = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.query.path);
  if (!targetPath) return res.json({ content: '' });
  try { res.json({ content: fs.readFileSync(targetPath, 'utf8') }); }
  catch(e) { res.json({ content: '', error: e.message }); }
});

router.post('/servers/:id/files/write', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir  = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.body.path);
  if (!targetPath) return res.json({ success: false, message: 'Invalid path' });
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, req.body.content || '', 'utf8');
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

router.post('/servers/:id/files/delete', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir  = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.body.path);
  if (!targetPath || targetPath === path.resolve(serverDir)) return res.json({ success: false, message: 'Cannot delete root' });
  try {
    const st = fs.statSync(targetPath);
    if (st.isDirectory()) fs.rmSync(targetPath, { recursive: true, force: true });
    else fs.unlinkSync(targetPath);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

router.post('/servers/:id/files/mkdir', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir  = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, path.join(req.body.path||'/', req.body.name));
  if (!targetPath) return res.json({ success: false });
  try { fs.mkdirSync(targetPath, { recursive: true }); res.json({ success: true }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});

router.post('/servers/:id/files/unzip', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir  = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.body.path);
  if (!targetPath) return res.json({ success: false });
  try {
    const { execSync } = require('child_process');
    const destDir = path.dirname(targetPath);
    execSync(`unzip -o "${targetPath}" -d "${destDir}"`, { timeout: 30000 });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

router.post('/servers/:id/files/zip', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const serverDir  = path.join(SERVERS_DIR, server._id.toString());
  const targetPath = safePath(serverDir, req.body.path);
  if (!targetPath) return res.json({ success: false });
  try {
    const { execSync } = require('child_process');
    const zipName = (req.body.name || path.basename(targetPath)) + '.zip';
    const zipPath = path.join(path.dirname(targetPath), zipName);
    execSync(`cd "${path.dirname(targetPath)}" && zip -r "${zipPath}" "${path.basename(targetPath)}"`, { timeout: 60000 });
    res.json({ success: true, zipPath });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===== SCHEDULES API =====
router.get('/servers/:id/schedules', async (req, res) => {
  const server    = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ schedules: [] });
  const schedules = await db.schedules.find({ serverId: server._id });
  res.json({ schedules });
});

// ===== SUBUSERS API =====
router.get('/servers/:id/subusers', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ subusers: [] });
  const subusers = await db.subusers.find({ serverId: server._id });
  for (const su of subusers) su.userInfo = await db.users.findOne({ _id: su.userId });
  res.json({ subusers });
});

// ===== LOGS =====
router.get('/servers/:id/logs', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server || !server.containerId) return res.json({ logs: '' });
  const logs = await docker.getLogs(server.containerId).catch(() => '');
  res.json({ logs });
});

// ===== USER COINS =====
router.get('/user/kxy', async (req, res) => {
  const user = await db.users.findOne({ _id: res.locals.user._id });
  res.json({ kxy: user?.kxy || 0 });
});

module.exports = router;
