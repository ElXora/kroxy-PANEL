const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const user = res.locals.user;
  const afkSetting   = await db.settings.findOne({ key: 'afk_reward_kxy' });
  const afkInterval  = await db.settings.findOne({ key: 'afk_interval_sec' });
  const freshUser    = await db.users.findOne({ _id: user._id });

  res.render('afk/index', {
    pageTitle: 'AFK Coins — Kroxy',
    layout: 'main',
    afkRewardKxy:   afkSetting  ? afkSetting.value  : 5,
    afkIntervalSec: afkInterval ? afkInterval.value : 60,
    kxy: freshUser.kxy || 0,
  });
});

router.post('/claim', async (req, res) => {
  const user = await db.users.findOne({ _id: res.locals.user._id });
  const now = new Date();
  const lastAfk = user.lastAfkReward ? new Date(user.lastAfkReward) : null;
  const setting = await db.settings.findOne({ key: 'afk_interval_sec' });
  const interval = (setting ? setting.value : 60) * 1000;
  if (lastAfk && (now - lastAfk) < interval) {
    return res.json({ success: false, wait: Math.ceil((interval - (now - lastAfk)) / 1000) });
  }
  const afkSetting = await db.settings.findOne({ key: 'afk_reward_kxy' });
  const reward = afkSetting ? afkSetting.value : 5;
  await db.users.update({ _id: user._id }, { $inc: { kxy: reward }, $set: { lastAfkReward: now } });
  const updated = await db.users.findOne({ _id: user._id });
  return res.json({ success: true, kxy: updated.kxy, reward });
});

module.exports = router;
