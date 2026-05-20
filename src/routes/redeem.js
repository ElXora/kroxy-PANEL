const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const user = await db.users.findOne({ _id: res.locals.user._id });
  const redeems = await db.redeems.find({ userId: user._id });
  const redeemedIds = redeems.map(r => r.couponId);

  res.render('redeem/index', {
    pageTitle: 'Redeem Code — Kroxy',
    layout: 'main',
    kxy: user.kxy || 0,
    redeemedCount: redeemedIds.length,
  });
});

router.post('/claim', async (req, res) => {
  const { code } = req.body;
  const user = await db.users.findOne({ _id: res.locals.user._id });
  if (!code) return res.json({ success: false, message: 'Enter a code.' });

  const coupon = await db.coupons.findOne({ code: code.trim().toUpperCase() });
  if (!coupon)         return res.json({ success: false, message: 'Invalid code.' });
  if (!coupon.active)  return res.json({ success: false, message: 'This code has been disabled.' });
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date())
    return res.json({ success: false, message: 'This code has expired.' });
  if (coupon.maxUses && coupon.uses >= coupon.maxUses)
    return res.json({ success: false, message: 'This code has reached its usage limit.' });

  const already = await db.redeems.findOne({ couponId: coupon._id, userId: user._id });
  if (already) return res.json({ success: false, message: 'You have already redeemed this code.' });

  const updates = {};
  const gains = [];
  if (coupon.kxy)     { updates.kxy        = (user.kxy        || 0) + coupon.kxy;     gains.push(`+${coupon.kxy} KXY`); }
  if (coupon.ramMB)   { updates.maxRamMB   = (user.maxRamMB   || 0) + coupon.ramMB;   gains.push(`+${coupon.ramMB}MB RAM`); }
  if (coupon.diskGB)  { updates.maxDiskGB  = (user.maxDiskGB  || 0) + coupon.diskGB;  gains.push(`+${coupon.diskGB}GB Disk`); }
  if (coupon.cpuPct)  { updates.maxCpuPct  = (user.maxCpuPct  || 0) + coupon.cpuPct;  gains.push(`+${coupon.cpuPct}% CPU`); }
  if (coupon.servers) { updates.maxServers = (user.maxServers || 0) + coupon.servers; gains.push(`+${coupon.servers} Server Slot(s)`); }

  await db.users.update({ _id: user._id }, { $set: updates });
  await db.redeems.insert({ couponId: coupon._id, userId: user._id, redeemedAt: new Date() });
  await db.coupons.update({ _id: coupon._id }, { $inc: { uses: 1 } });
  await db.activity.insert({
    userId: user._id, action: 'coupon_redeemed',
    details: `Redeemed ${coupon.code}: ${gains.join(', ')}`, createdAt: new Date(),
  });

  const updated = await db.users.findOne({ _id: user._id });
  return res.json({ success: true, message: `Redeemed! You got: ${gains.join(', ')}`, gains, kxy: updated.kxy });
});

module.exports = router;
