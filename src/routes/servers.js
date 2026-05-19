const express = require('express');
const router = express.Router();
const db = require('../db');
const docker = require('../services/docker');

// Random port helper
function randomPort() {
  return Math.floor(Math.random() * (65535 - 25000 + 1)) + 25000;
}

async function getFreePort() {
  let port, attempts = 0;
  do {
    port = randomPort();
    const inUse = await db.servers.findOne({ port });
    if (!inUse) return port;
    attempts++;
  } while (attempts < 20);
  return port;
}

router.get('/', async (req, res) => {
  const servers = await db.servers.find({ userId: res.locals.user._id });
  for (const s of servers) {
    if (s.nodeId) s.node = await db.nodes.findOne({ _id: s.nodeId });
  }
  res.render('servers/index', { pageTitle: 'Servers — Kroxy', layout: 'main', servers });
});

router.get('/create', async (req, res) => {
  const user = res.locals.user;
  const count = await db.servers.count({ userId: user._id });
  const maxServers = user.maxServers || 3;
  if (count >= maxServers && !user.isAdmin) {
    req.flash('error', `You have reached your server limit (${maxServers}). Redeem a coupon or contact admin.`);
    return res.redirect('/servers');
  }
  const nodes = await db.nodes.find({ status: 'online' });
  if (!nodes.length) {
    req.flash('error', 'No nodes available. Ask an admin to add a node.');
    return res.redirect('/servers');
  }
  const suggestedPort = await getFreePort();
  res.render('servers/create', {
    pageTitle: 'Create Server — Kroxy',
    layout: 'main',
    nodes,
    suggestedPort,
    mcVersions: ['LATEST','1.21.4','1.20.6','1.20.4','1.20.1','1.19.4','1.18.2','1.17.1','1.16.5','1.12.2','1.8.9'],
    user,
  });
});

router.post('/create', async (req, res) => {
  const { name, version, ram, cpu, disk, port, nodeId } = req.body;
  const user = res.locals.user;

  if (!name || !version || !ram || !port || !nodeId) {
    req.flash('error', 'All fields are required.');
    return res.redirect('/servers/create');
  }

  const node = await db.nodes.findOne({ _id: nodeId, status: 'online' });
  if (!node) { req.flash('error', 'Selected node is unavailable.'); return res.redirect('/servers/create'); }

  // Check user resource limits
  const userServers = await db.servers.find({ userId: user._id });
  const usedRam  = userServers.reduce((a, s) => a + (s.ram  || 0), 0);
  const usedCpu  = userServers.reduce((a, s) => a + (s.cpu  || 0), 0);
  const usedDisk = userServers.reduce((a, s) => a + (s.disk || 0), 0);

  const ramVal  = parseInt(ram);
  const cpuVal  = parseInt(cpu)  || 100;
  const diskVal = parseInt(disk) || 5;

  if (!user.isAdmin) {
    if (usedRam  + ramVal  > (user.maxRamMB   || 2048)) { req.flash('error', 'Not enough RAM in your allocation.'); return res.redirect('/servers/create'); }
    if (usedCpu  + cpuVal  > (user.maxCpuPct  || 100))  { req.flash('error', 'Not enough CPU in your allocation.'); return res.redirect('/servers/create'); }
    if (usedDisk + diskVal > (user.maxDiskGB  || 10))   { req.flash('error', 'Not enough disk in your allocation.'); return res.redirect('/servers/create'); }
  }

  // Check node capacity
  const nodeCount = await db.servers.count({ nodeId });
  if (nodeCount >= node.maxServers) { req.flash('error', `Node "${node.name}" is full.`); return res.redirect('/servers/create'); }

  const portNum = parseInt(port);
  if (portNum < 1024 || portNum > 65535) { req.flash('error', 'Invalid port.'); return res.redirect('/servers/create'); }
  const portInUse = await db.servers.findOne({ port: portNum });
  if (portInUse) { req.flash('error', 'Port already in use. Try a different port.'); return res.redirect('/servers/create'); }

  // Use node FQDN/CF hostname as connect address
  // Use CF hostname > FQDN > connectIp (handles localhost/0.0.0.0 correctly)
  const connectHost = (node.cfEnabled && node.cfPublicHostname) ? node.cfPublicHostname : (node.fqdn || node.connectIp || node.ip);

  const server = await db.servers.insert({
    userId: user._id,
    nodeId,
    name: name.trim().substring(0, 32),
    game: 'minecraft',
    containerId: null,
    status: 'installing',
    port: portNum,
    ram: ramVal,
    cpu: cpuVal,
    disk: diskVal,
    version,
    connectAddress: `${connectHost}:${portNum}`,
    nodeIp: node.ip,
    nodeName: node.name,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.activity.insert({
    userId: user._id, serverId: server._id,
    action: 'server_created',
    details: `Created "${name}" on ${node.name} — ${connectHost}:${portNum}`,
    createdAt: new Date(),
  });

  docker.createMinecraftServer(server).then(async (result) => {
    if (result.success) {
      await db.servers.update({ _id: server._id }, { $set: { containerId: result.containerId, status: 'offline', updatedAt: new Date() } });
    } else {
      await db.servers.update({ _id: server._id }, { $set: { status: 'error', updatedAt: new Date() } });
    }
  }).catch(() => db.servers.update({ _id: server._id }, { $set: { status: 'error' } }));

  req.flash('success', `Server "${name}" created on ${node.name}! Connect: ${connectHost}:${portNum}`);
  res.redirect('/servers/' + server._id);
});

router.get('/:id', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) { req.flash('error', 'Server not found.'); return res.redirect('/servers'); }
  let node = null;
  if (server.nodeId) node = await db.nodes.findOne({ _id: server.nodeId });
  if (server.containerId) {
    try {
      const status = await docker.getStatus(server.containerId);
      if (status !== server.status) {
        await db.servers.update({ _id: server._id }, { $set: { status, updatedAt: new Date() } });
        server.status = status;
      }
    } catch (e) {}
  }
  res.render('servers/show', { pageTitle: server.name + ' — Kroxy', layout: 'main', server, node });
});

router.post('/:id/start', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false, message: 'Not found' });
  if (!server.containerId) return res.json({ success: false, message: 'Container not ready' });
  const ok = await docker.startContainer(server.containerId);
  if (ok) {
    await db.servers.update({ _id: server._id }, { $set: { status: 'running', updatedAt: new Date() } });
    await db.activity.insert({ userId: res.locals.user._id, serverId: server._id, action: 'server_start', details: `Started "${server.name}"`, createdAt: new Date() });
  }
  res.json({ success: ok });
});

router.post('/:id/stop', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server || !server.containerId) return res.json({ success: false });
  const ok = await docker.stopContainer(server.containerId);
  if (ok) {
    await db.servers.update({ _id: server._id }, { $set: { status: 'offline', updatedAt: new Date() } });
    await db.activity.insert({ userId: res.locals.user._id, serverId: server._id, action: 'server_stop', details: `Stopped "${server.name}"`, createdAt: new Date() });
  }
  res.json({ success: ok });
});

router.post('/:id/restart', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server || !server.containerId) return res.json({ success: false });
  const ok = await docker.restartContainer(server.containerId);
  if (ok) await db.servers.update({ _id: server._id }, { $set: { status: 'running', updatedAt: new Date() } });
  res.json({ success: ok });
});

router.post('/:id/delete', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.redirect('/servers');
  if (server.containerId) await docker.removeContainer(server.containerId);
  await db.servers.remove({ _id: server._id });
  req.flash('success', `Server "${server.name}" deleted.`);
  res.redirect('/servers');
});

router.post('/:id/command', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server || !server.containerId) return res.json({ success: false });
  const { command } = req.body;
  if (!command) return res.json({ success: false });
  const ok = await docker.sendCommand(server.containerId, command);
  res.json({ success: ok });
});

module.exports = router;
