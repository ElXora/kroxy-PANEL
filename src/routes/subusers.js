const express = require('express');
const router  = express.Router();
const db      = require('../db');

const ALL_PERMS = ['console','files','schedules','startup','settings'];

router.get('/:id/subusers', async (req, res) => {
  const server   = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) { req.flash('error', 'Server not found.'); return res.redirect('/servers'); }
  const subusers = await db.subusers.find({ serverId: server._id });
  // Attach user info
  for (const su of subusers) {
    su.userInfo = await db.users.findOne({ _id: su.userId });
  }
  res.render('servers/subusers', { pageTitle: server.name + ' — Sub-users', layout: 'main', server, subusers, ALL_PERMS });
});

router.post('/:id/subusers/add', async (req, res) => {
  const server = await db.servers.findOne({ _id: req.params.id, userId: res.locals.user._id });
  if (!server) return res.json({ success: false });
  const { email, permissions } = req.body;
  const targetUser = await db.users.findOne({ email: email.trim() });
  if (!targetUser) return res.json({ success: false, message: 'User not found with that email.' });
  if (targetUser._id === server.userId) return res.json({ success: false, message: 'That\'s the server owner.' });
  const exists = await db.subusers.findOne({ serverId: server._id, userId: targetUser._id });
  if (exists) return res.json({ success: false, message: 'User already has access.' });
  const perms = Array.isArray(permissions) ? permissions : (permissions ? [permissions] : []);
  await db.subusers.insert({ serverId: server._id, userId: targetUser._id, permissions: perms, createdAt: new Date() });
  return res.json({ success: true, message: `${targetUser.username} added.` });
});

router.post('/:id/subusers/:sid/remove', async (req, res) => {
  await db.subusers.remove({ _id: req.params.sid });
  req.flash('success', 'Sub-user removed.');
  res.redirect(`/servers/${req.params.id}/subusers`);
});

module.exports = router;
