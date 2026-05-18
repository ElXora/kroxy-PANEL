const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const nodes = await db.nodes.find({});
  for (const node of nodes) {
    node.serverCount = await db.servers.count({ nodeId: node._id });
    // Recalculate used resources
    const nodeServers = await db.servers.find({ nodeId: node._id });
    node.usedRamMB  = nodeServers.reduce((a, s) => a + (s.ram  || 0), 0);
    node.usedCpuPct = nodeServers.reduce((a, s) => a + (s.cpu  || 0), 0);
    node.usedDiskGB = nodeServers.reduce((a, s) => a + (s.disk || 0), 0);
  }
  res.render('admin/nodes', { pageTitle: 'Nodes — Kroxy', layout: 'main', nodes });
});

router.post('/create', async (req, res) => {
  const {
    name, region, ip, fqdn, maxServers, daemonPort,
    totalDiskGB, totalRamMB, totalCpuPct,
    cfEnabled, cfTunnelUrl, cfPublicHostname,
  } = req.body;

  if (!name || !ip) {
    req.flash('error', 'Name and IP are required.');
    return res.redirect('/admin/nodes');
  }
  const existing = await db.nodes.findOne({ ip });
  if (existing) {
    req.flash('error', 'A node with that IP already exists.');
    return res.redirect('/admin/nodes');
  }

  await db.nodes.insert({
    name: name.trim(),
    region: region || 'Unknown',
    ip: ip.trim(),
    fqdn: (fqdn || ip).trim(),
    maxServers:   parseInt(maxServers)   || 10,
    daemonPort:   parseInt(daemonPort)   || 2375,
    totalDiskGB:  parseInt(totalDiskGB)  || 50,
    totalRamMB:   parseInt(totalRamMB)   || 4096,
    totalCpuPct:  parseInt(totalCpuPct)  || 400,
    usedDiskGB: 0, usedRamMB: 0, usedCpuPct: 0,
    cfEnabled:         !!cfEnabled,
    cfTunnelUrl:       (cfTunnelUrl       || '').trim(),
    cfPublicHostname:  (cfPublicHostname  || '').trim(),
    status: 'online',
    createdAt: new Date(),
  });

  req.flash('success', `Node "${name}" created.`);
  res.redirect('/admin/nodes');
});

router.post('/:id/delete', async (req, res) => {
  const node = await db.nodes.findOne({ _id: req.params.id });
  if (!node) { req.flash('error', 'Node not found.'); return res.redirect('/admin/nodes'); }
  const sc = await db.servers.count({ nodeId: node._id });
  if (sc > 0) {
    req.flash('error', `Cannot delete — ${sc} server(s) still assigned.`);
    return res.redirect('/admin/nodes');
  }
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
