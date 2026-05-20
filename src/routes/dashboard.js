const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const user = res.locals.user;
  const servers = await db.servers.find({ userId: user._id });

  // Daily reward
  const now = new Date();
  const lastReward = user.lastDailyReward ? new Date(user.lastDailyReward) : null;
  const canClaim = !lastReward || (now - lastReward) >= 24 * 60 * 60 * 1000;
  const nextRewardMs = canClaim ? 0 : (lastReward.getTime() + 86400000) - now.getTime();

  const activity = await db.activity.find({ userId: user._id }).sort({ createdAt: -1 }).limit(8).exec();

  // Resource usage
  const usedRamMB  = servers.reduce((a, s) => a + (s.ram  || 0), 0);
  const usedCpuPct = servers.reduce((a, s) => a + (s.cpu  || 0), 0);
  const usedDiskGB = servers.reduce((a, s) => a + (s.disk || 0), 0);

  const maxRamMB   = user.maxRamMB   || 2048;
  const maxCpuPct  = user.maxCpuPct  || 100;
  const maxDiskGB  = user.maxDiskGB  || 10;
  const maxServers = user.maxServers || 3;

  const dailySetting = await db.settings.findOne({ key: 'daily_reward_kxy' });
  const afkSetting   = await db.settings.findOne({ key: 'afk_reward_kxy' });
  const afkInterval  = await db.settings.findOne({ key: 'afk_interval_sec' });

  res.render('dashboard/index', {
    pageTitle: 'Dashboard — Kroxy',
    layout: 'main',
    servers,
    canClaim,
    nextRewardMs,
    activity,
    totalServers: servers.length,
    runningServers: servers.filter(s => s.status === 'running').length,
    dailyRewardKxy: dailySetting ? dailySetting.value : 50,
    afkRewardKxy:   afkSetting   ? afkSetting.value   : 5,
    afkIntervalSec: afkInterval  ? afkInterval.value  : 60,
    usedRamMB, usedCpuPct, usedDiskGB,
    maxRamMB, maxCpuPct, maxDiskGB, maxServers,
  });
});

router.post('/claim-reward', async (req, res) => {
  const user = res.locals.user;
  const now = new Date();
  const lastReward = user.lastDailyReward ? new Date(user.lastDailyReward) : null;
  const canClaim = !lastReward || (now - lastReward) >= 24 * 60 * 60 * 1000;
  if (!canClaim) return res.json({ success: false, message: 'Already claimed today.' });

  const setting = await db.settings.findOne({ key: 'daily_reward_kxy' });
  const reward = setting ? setting.value : 50;
  await db.users.update({ _id: user._id }, { $inc: { kxy: reward }, $set: { lastDailyReward: now } });
  await db.activity.insert({ userId: user._id, action: 'daily_reward', details: `Claimed ${reward} KXY`, createdAt: new Date() });
  return res.json({ success: true, kxy: (user.kxy || 0) + reward, reward });
});

router.post('/afk-reward', async (req, res) => {
  const user = res.locals.user;
  const now = new Date();
  const lastAfk = user.lastAfkReward ? new Date(user.lastAfkReward) : null;
  const setting = await db.settings.findOne({ key: 'afk_interval_sec' });
  const interval = (setting ? setting.value : 60) * 1000;
  if (lastAfk && (now - lastAfk) < interval) {
    return res.json({ success: false, wait: interval - (now - lastAfk) });
  }
  const afkSetting = await db.settings.findOne({ key: 'afk_reward_kxy' });
  const reward = afkSetting ? afkSetting.value : 5;
  await db.users.update({ _id: user._id }, { $inc: { kxy: reward }, $set: { lastAfkReward: now } });
  return res.json({ success: true, kxy: (user.kxy || 0) + reward, reward });
});

router.post('/redeem', async (req, res) => {
  const { code } = req.body;
  const user = res.locals.user;
  if (!code) return res.json({ success: false, message: 'Enter a code.' });

  const coupon = await db.coupons.findOne({ code: code.trim().toUpperCase() });
  if (!coupon) return res.json({ success: false, message: 'Invalid code.' });
  if (!coupon.active) return res.json({ success: false, message: 'This code is no longer active.' });
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return res.json({ success: false, message: 'This code has expired.' });
  }
  if (coupon.maxUses && coupon.uses >= coupon.maxUses) {
    return res.json({ success: false, message: 'This code has reached its usage limit.' });
  }

  const alreadyRedeemed = await db.redeems.findOne({ couponId: coupon._id, userId: user._id });
  if (alreadyRedeemed) return res.json({ success: false, message: 'You have already redeemed this code.' });

  // Apply rewards
  const updates = {};
  const gains = [];
  if (coupon.kxy)        { updates.kxy        = (user.kxy        || 0) + coupon.kxy;        gains.push(`+${coupon.kxy} KXY`); }
  if (coupon.ramMB)      { updates.maxRamMB   = (user.maxRamMB   || 0) + coupon.ramMB;      gains.push(`+${coupon.ramMB}MB RAM`); }
  if (coupon.diskGB)     { updates.maxDiskGB  = (user.maxDiskGB  || 0) + coupon.diskGB;     gains.push(`+${coupon.diskGB}GB Disk`); }
  if (coupon.cpuPct)     { updates.maxCpuPct  = (user.maxCpuPct  || 0) + coupon.cpuPct;     gains.push(`+${coupon.cpuPct}% CPU`); }
  if (coupon.servers)    { updates.maxServers = (user.maxServers || 0) + coupon.servers;    gains.push(`+${coupon.servers} Server slot(s)`); }

  await db.users.update({ _id: user._id }, { $set: updates });
  await db.redeems.insert({ couponId: coupon._id, userId: user._id, redeemedAt: new Date() });
  await db.coupons.update({ _id: coupon._id }, { $inc: { uses: 1 } });
  await db.activity.insert({ userId: user._id, action: 'coupon_redeemed', details: `Redeemed code ${coupon.code}: ${gains.join(', ')}`, createdAt: new Date() });

  return res.json({ success: true, message: `Redeemed! You got: ${gains.join(', ')}`, gains });
});

module.exports = router;
