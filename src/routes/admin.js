const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const users = await db.users.find({});
  const servers = await db.servers.find({});
  const activity = await db.activity.find({}).sort({ createdAt: -1 }).limit(20).exec();
  const coupons = await db.coupons.find({}).sort({ createdAt: -1 }).exec();
  res.render('admin/index', {
    pageTitle: 'Admin — Kroxy', layout: 'main',
    users, servers, activity, coupons,
    totalUsers: users.length,
    totalServers: servers.length,
    runningServers: servers.filter(s => s.status === 'running').length,
  });
});

// Ban/Unban
router.post('/users/:id/ban',   async (req, res) => { await db.users.update({ _id: req.params.id }, { $set: { isBanned: true  } }); req.flash('success', 'User banned.');   res.redirect('/admin'); });
router.post('/users/:id/unban', async (req, res) => { await db.users.update({ _id: req.params.id }, { $set: { isBanned: false } }); req.flash('success', 'User unbanned.'); res.redirect('/admin'); });

// Make admin / remove admin
router.post('/users/:id/makeadmin',   async (req, res) => { await db.users.update({ _id: req.params.id }, { $set: { isAdmin: true  } }); req.flash('success', 'User is now admin.');  res.redirect('/admin'); });
router.post('/users/:id/removeadmin', async (req, res) => { await db.users.update({ _id: req.params.id }, { $set: { isAdmin: false } }); req.flash('success', 'Admin removed.');       res.redirect('/admin'); });

// Create user
router.post('/users/create', async (req, res) => {
  const { username, email, password, isAdmin } = req.body;
  if (!username || !email || !password) { req.flash('error', 'Fill all fields.'); return res.redirect('/admin'); }
  try {
    const hash = await bcrypt.hash(password, 10);
    const settings = await db.settings.find({ key: { $in: ['default_max_ram','default_max_disk','default_max_cpu','default_max_servers'] } });
    const getSetting = (k, d) => { const s = settings.find(x => x.key === k); return s ? s.value : d; };
    await db.users.insert({
      username, email, password: hash,
      kxy: 100, isAdmin: !!isAdmin, isBanned: false,
      lastDailyReward: null, lastAfkReward: null,
      maxRamMB:   getSetting('default_max_ram',     2048),
      maxDiskGB:  getSetting('default_max_disk',    10),
      maxCpuPct:  getSetting('default_max_cpu',     100),
      maxServers: getSetting('default_max_servers', 3),
      createdAt: new Date(),
    });
    req.flash('success', `User "${username}" created.`);
  } catch(e) { req.flash('error', 'Username or email already taken.'); }
  res.redirect('/admin');
});

// Edit user resources
router.post('/users/:id/resources', async (req, res) => {
  const { maxRamMB, maxDiskGB, maxCpuPct, maxServers, kxy } = req.body;
  await db.users.update({ _id: req.params.id }, { $set: {
    maxRamMB:   parseInt(maxRamMB)   || 2048,
    maxDiskGB:  parseInt(maxDiskGB)  || 10,
    maxCpuPct:  parseInt(maxCpuPct)  || 100,
    maxServers: parseInt(maxServers) || 3,
    kxy:        parseInt(kxy)        || 0,
  }});
  req.flash('success', 'User resources updated.');
  res.redirect('/admin');
});

// Create coupon
router.post('/coupons/create', async (req, res) => {
  const { code, kxy, ramMB, diskGB, cpuPct, servers, maxUses, expiresAt } = req.body;
  if (!code) { req.flash('error', 'Code is required.'); return res.redirect('/admin'); }
  try {
    await db.coupons.insert({
      code: code.trim().toUpperCase(),
      kxy:     parseInt(kxy)     || 0,
      ramMB:   parseInt(ramMB)   || 0,
      diskGB:  parseInt(diskGB)  || 0,
      cpuPct:  parseInt(cpuPct)  || 0,
      servers: parseInt(servers) || 0,
      maxUses: parseInt(maxUses) || 0,
      uses: 0,
      active: true,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdAt: new Date(),
    });
    req.flash('success', `Coupon "${code.toUpperCase()}" created.`);
  } catch(e) { req.flash('error', 'Code already exists.'); }
  res.redirect('/admin');
});

// Delete coupon
router.post('/coupons/:id/delete', async (req, res) => {
  await db.coupons.remove({ _id: req.params.id });
  req.flash('success', 'Coupon deleted.');
  res.redirect('/admin');
});

// Toggle coupon active
router.post('/coupons/:id/toggle', async (req, res) => {
  const c = await db.coupons.findOne({ _id: req.params.id });
  if (!c) return res.json({ success: false });
  await db.coupons.update({ _id: req.params.id }, { $set: { active: !c.active } });
  res.json({ success: true, active: !c.active });
});

// Settings
router.post('/settings', async (req, res) => {
  const { registration_enabled, max_servers_per_user, daily_reward_kxy, afk_reward_kxy, afk_interval_sec, default_max_ram, default_max_disk, default_max_cpu, default_max_servers } = req.body;
  const updates = [
    ['registration_enabled',  !!registration_enabled],
    ['max_servers_per_user',  parseInt(max_servers_per_user)  || 3],
    ['daily_reward_kxy',      parseInt(daily_reward_kxy)      || 50],
    ['afk_reward_kxy',        parseInt(afk_reward_kxy)        || 5],
    ['afk_interval_sec',      parseInt(afk_interval_sec)      || 60],
    ['default_max_ram',       parseInt(default_max_ram)       || 2048],
    ['default_max_disk',      parseInt(default_max_disk)      || 10],
    ['default_max_cpu',       parseInt(default_max_cpu)       || 100],
    ['default_max_servers',   parseInt(default_max_servers)   || 3],
  ];
  for (const [key, value] of updates) {
    await db.settings.update({ key }, { $set: { value } }, { upsert: true });
  }
  req.flash('success', 'Settings saved.');
  res.redirect('/admin');
});

module.exports = router;
