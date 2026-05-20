const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const db      = require('../db');

router.get('/', async (req, res) => {
  const user = await db.users.findOne({ _id: res.locals.user._id });
  res.render('account/index', {
    pageTitle: 'Account — Kroxy',
    layout: 'main',
    user,
  });
});

// Change email
router.post('/change-email', async (req, res) => {
  const { newEmail, currentPassword } = req.body;
  const user = await db.users.findOne({ _id: res.locals.user._id });
  if (!newEmail || !currentPassword) return res.json({ success: false, message: 'All fields required.' });
  if (!await bcrypt.compare(currentPassword, user.password)) return res.json({ success: false, message: 'Incorrect current password.' });
  const exists = await db.users.findOne({ email: newEmail, _id: { $ne: user._id } });
  if (exists) return res.json({ success: false, message: 'Email already in use.' });
  await db.users.update({ _id: user._id }, { $set: { email: newEmail } });
  return res.json({ success: true, message: 'Email updated successfully.' });
});

// Change password
router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const user = await db.users.findOne({ _id: res.locals.user._id });
  if (!currentPassword || !newPassword) return res.json({ success: false, message: 'All fields required.' });
  if (!await bcrypt.compare(currentPassword, user.password)) return res.json({ success: false, message: 'Incorrect current password.' });
  if (newPassword.length < 8) return res.json({ success: false, message: 'New password must be at least 8 characters.' });
  if (newPassword !== confirmPassword) return res.json({ success: false, message: 'Passwords do not match.' });
  const hash = await bcrypt.hash(newPassword, 10);
  await db.users.update({ _id: user._id }, { $set: { password: hash } });
  return res.json({ success: true, message: 'Password updated. Please log in again.' });
});

module.exports = router;
