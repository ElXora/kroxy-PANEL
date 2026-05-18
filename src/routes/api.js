const express = require('express');
const router = express.Router();
const db = require('../db');
const docker = require('../services/docker');

router.get('/servers/:id/stats', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server?.containerId) return res.json({ cpu: 0, mem: 0, memLimit: 0, status: server?.status || 'unknown' });

  const stats = await docker.getStats(server.containerId);
  const status = await docker.getStatus(server.containerId);
  res.json({ ...stats, status });
});

router.get('/servers/:id/logs', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server?.containerId) return res.json({ logs: '' });

  const logs = await docker.getLogs(server.containerId);
  res.json({ logs });
});

router.get('/user/coins', async (req, res) => {
  const user = await db.users.findOne({ _id: res.locals.user._id });
  res.json({ coins: user?.coins || 0 });
});

module.exports = router;
