const express = require('express');
const router  = express.Router();
const db      = require('../db');

// Streak reward table - day 1..30, caps at 200 KXY on day 30+
function getStreakReward(streak) {
  const day = Math.min(streak, 30);
  // Day 1 = 10 KXY, scales linearly to day 30 = 200 KXY
  const min = 10, max = 200, days = 30;
  return Math.round(min + ((max - min) / (days - 1)) * (day - 1));
}

router.get('/', async (req, res) => {
  const user       = await db.users.findOne({ _id: res.locals.user._id });
  const now        = new Date();
  const lastReward = user.lastDailyReward ? new Date(user.lastDailyReward) : null;

  // Check if within same calendar day (UTC)
  const todayStr = now.toISOString().slice(0, 10);
  const lastStr  = lastReward ? lastReward.toISOString().slice(0, 10) : null;
  const canClaim = lastStr !== todayStr;

  // Check streak — if last claim was yesterday keep streak, else reset
  let streak = user.dailyStreak || 0;
  if (lastReward) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yestStr = yesterday.toISOString().slice(0, 10);
    if (lastStr === yestStr) {
      // Claimed yesterday — streak continues (will +1 on claim)
    } else if (lastStr === todayStr) {
      // Already claimed today — streak is current
    } else {
      // Missed a day — streak broken
      streak = 0;
    }
  }

  const nextStreak    = canClaim ? streak + 1 : streak;
  const todayReward   = getStreakReward(nextStreak);
  const nextRewardMs  = canClaim ? 0 : (new Date(todayStr + 'T00:00:00Z').getTime() + 86400000) - now.getTime();

  // Build 30-day calendar
  const calendar = Array.from({ length: 30 }, (_, i) => ({
    day:     i + 1,
    reward:  getStreakReward(i + 1),
    claimed: i + 1 <= streak && lastStr !== null,
    today:   i + 1 === nextStreak && canClaim,
    locked:  i + 1 > nextStreak,
  }));

  res.render('daily/index', {
    pageTitle:    'Daily Reward — Kroxy',
    layout:       'main',
    user,
    streak,
    nextStreak,
    todayReward,
    canClaim,
    nextRewardMs,
    calendar,
    maxStreak:    30,
    maxReward:    200,
  });
});

router.post('/claim', async (req, res) => {
  const user       = await db.users.findOne({ _id: res.locals.user._id });
  const now        = new Date();
  const lastReward = user.lastDailyReward ? new Date(user.lastDailyReward) : null;
  const todayStr   = now.toISOString().slice(0, 10);
  const lastStr    = lastReward ? lastReward.toISOString().slice(0, 10) : null;

  if (lastStr === todayStr) {
    return res.json({ success: false, message: 'Already claimed today. Come back tomorrow!' });
  }

  // Determine new streak
  let streak = user.dailyStreak || 0;
  if (lastReward) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yestStr = yesterday.toISOString().slice(0, 10);
    if (lastStr === yestStr) {
      streak += 1; // continued streak
    } else {
      streak = 1;  // streak broken, restart
    }
  } else {
    streak = 1; // first ever claim
  }

  const reward = getStreakReward(streak);

  await db.users.update({ _id: user._id }, {
    $inc: { kxy: reward },
    $set: { lastDailyReward: now, dailyStreak: streak },
  });

  await db.activity.insert({
    userId:    user._id,
    action:    'daily_reward',
    details:   `Day ${streak} streak — claimed ${reward} KXY`,
    createdAt: now,
  });

  const updated = await db.users.findOne({ _id: user._id });
  return res.json({
    success: true,
    reward,
    streak,
    kxy: updated.kxy,
    message: `Day ${streak}! +${reward} KXY claimed!`,
  });
});

module.exports = router;
