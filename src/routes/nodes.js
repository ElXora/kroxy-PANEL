const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const nodes = await db.nodes.find({});
  for (const node of nodes) {
    node.serverCount = await db.servers.count({ nodeId: node._id });
    const nodeServers = await db.servers.find({ nodeId: node._id });
    node.usedRamMB  = nodeServers.reduce((a, s) => a + (s.ram  || 0), 0);
    node.usedCpuPct = nodeServers.reduce((a, s) => a + (s.cpu  || 0), 0);
    node.usedDiskGB = nodeServers.reduce((a, s) => a + (s.disk || 0), 0);
  }
  res.render('admin/nodes', { pageTitle: 'Nodes — Kroxy', layout: 'main', nodes });
});

router.post('/create', async (req, res) => {
  const {
    name, region, ip, fqdn,
    maxServers, daemonPort,
    totalDiskGB, totalRamMB, totalCpuPct,
    cfEnabled, cfTunnelUrl, cfPublicHostname,
  } = req.body;

  if (!name || !ip) { req.flash('error', 'Name and IP are required.'); return res.redirect('/admin/nodes'); }
  const existing = await db.nodes.findOne({ ip });
  if (existing) { req.flash('error', 'A node with that IP already exists.'); return res.redirect('/admin/nodes'); }

  // Determine the actual connect address based on IP input
  const ipTrimmed = ip.trim().toLowerCase();
  let connectIp = ip.trim();
  if (ipTrimmed === 'localhost' || ipTrimmed === '127.0.0.1') connectIp = 'localhost';
  else if (ipTrimmed === '0.0.0.0') connectIp = '0.0.0.0';

  // Generate daemon activation token
  const daemonToken = crypto.randomBytes(32).toString('hex');
  const resolvedDaemonPort = parseInt(daemonPort) || 3002;

  // If CF tunnel, the local daemon URL must be localhost:daemonPort
  const cfUrl = cfEnabled ? (cfTunnelUrl || `http://localhost:${resolvedDaemonPort}`) : '';

  const node = await db.nodes.insert({
    name: name.trim(),
    region: region || 'Unknown',
    ip: ip.trim(),
    connectIp,
    fqdn: (fqdn || connectIp).trim(),
    maxServers:   parseInt(maxServers)  || 10,
    daemonPort:   resolvedDaemonPort,
    totalDiskGB:  parseInt(totalDiskGB) || 50,
    totalRamMB:   parseInt(totalRamMB)  || 4096,
    totalCpuPct:  parseInt(totalCpuPct) || 400,
    cfEnabled:        !!cfEnabled,
    cfTunnelUrl:      cfUrl,
    cfPublicHostname: (cfPublicHostname || '').trim(),
    daemonToken,
    status: 'pending',   // pending until activated
    createdAt: new Date(),
  });

  req.flash('success', `Node "${name}" created. Follow the activation steps to bring it online.`);
  res.redirect('/admin/nodes?activate=' + node._id);
});

// Show activation instructions for a node
router.get('/:id/activate', async (req, res) => {
  const node = await db.nodes.findOne({ _id: req.params.id });
  if (!node) { req.flash('error', 'Node not found.'); return res.redirect('/admin/nodes'); }
  res.render('admin/node-activate', { pageTitle: 'Activate Node — Kroxy', layout: 'main', node });
});

// Daemon calls this to check in and mark node online
router.post('/:id/heartbeat', async (req, res) => {
  const node = await db.nodes.findOne({ _id: req.params.id });
  if (!node) return res.status(404).json({ error: 'Node not found' });
  const token = req.headers['x-daemon-token'] || req.body.token;
  if (token !== node.daemonToken) return res.status(401).json({ error: 'Invalid token' });
  await db.nodes.update({ _id: node._id }, { $set: { status: 'online', lastHeartbeat: new Date() } });
  res.json({ success: true, name: node.name });
});

// Admin manually mark online (for testing/local nodes)
router.post('/:id/force-online', async (req, res) => {
  await db.nodes.update({ _id: req.params.id }, { $set: { status: 'online', lastHeartbeat: new Date() } });
  req.flash('success', 'Node marked online.');
  res.redirect('/admin/nodes');
});

router.post('/:id/delete', async (req, res) => {
  const node = await db.nodes.findOne({ _id: req.params.id });
  if (!node) { req.flash('error', 'Node not found.'); return res.redirect('/admin/nodes'); }
  const sc = await db.servers.count({ nodeId: node._id });
  if (sc > 0) { req.flash('error', `Cannot delete — ${sc} server(s) still assigned.`); return res.redirect('/admin/nodes'); }
  await db.nodes.remove({ _id: req.params.id });
  req.flash('success', `Node "${node.name}" deleted.`);
  res.redirect('/admin/nodes');
});

router.post('/:id/toggle', async (req, res) => {
  const node = await db.nodes.findOne({ _id: req.params.id });
  if (!node) return res.json({ success: false });
  const newStatus = node.status === 'online' ? 'maintenance' : 'online';
  await db.nodes.update({ _id: req.params.id }, { $set: { status: newStatus } });
  res.json({ success: true, status: newStatus });
});

module.exports = router;
