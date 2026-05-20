const express = require('express');
const router  = express.Router();
const db      = require('../db');
const docker  = require('../services/docker');

// List schedules for a server
router.get('/:id/schedules', async (req, res) => {
  const server    = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) { req.flash('error', 'Server not found.'); return res.redirect('/servers'); }
  const schedules = await db.schedules.find({ serverId: server._id });
  res.render('servers/schedules', { pageTitle: server.name + ' — Schedules', layout: 'main', server, schedules });
});

// Create schedule
router.post('/:id/schedules/create', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const { name, cronMinute, cronHour, cronDay, cronMonth, cronWeekday, action, payload, enabled } = req.body;
  await db.schedules.insert({
    serverId: server._id,
    name: name || 'Unnamed',
    cron: `${cronMinute||'*'} ${cronHour||'*'} ${cronDay||'*'} ${cronMonth||'*'} ${cronWeekday||'*'}`,
    action,   // 'command', 'restart', 'start', 'stop'
    payload:  payload || '',
    enabled:  !!enabled,
    lastRun:  null,
    createdAt: new Date(),
  });
  req.flash('success', 'Schedule created.');
  res.redirect(`/servers/${server._id}/schedules`);
});

// Delete schedule
router.post('/:id/schedules/:sid/delete', async (req, res) => {
  await db.schedules.remove({ _id: req.params.sid });
  req.flash('success', 'Schedule deleted.');
  res.redirect(`/servers/${req.params.id}/schedules`);
});

// Toggle schedule
router.post('/:id/schedules/:sid/toggle', async (req, res) => {
  const s = await db.schedules.findOne({ _id: req.params.sid });
  if (!s) return res.json({ success: false });
  await db.schedules.update({ _id: s._id }, { $set: { enabled: !s.enabled } });
  res.json({ success: true, enabled: !s.enabled });
});

module.exports = router;
