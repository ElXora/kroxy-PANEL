const Datastore = require('nedb-promises');
const path = require('path');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '../data');

const db = {
  users:     Datastore.create({ filename: path.join(dataDir, 'users.db'),     autoload: true }),
  servers:   Datastore.create({ filename: path.join(dataDir, 'servers.db'),   autoload: true }),
  nodes:     Datastore.create({ filename: path.join(dataDir, 'nodes.db'),     autoload: true }),
  activity:  Datastore.create({ filename: path.join(dataDir, 'activity.db'),  autoload: true }),
  settings:  Datastore.create({ filename: path.join(dataDir, 'settings.db'),  autoload: true }),
  backups:   Datastore.create({ filename: path.join(dataDir, 'backups.db'),   autoload: true }),
  schedules: Datastore.create({ filename: path.join(dataDir, 'schedules.db'), autoload: true }),
  subusers:  Datastore.create({ filename: path.join(dataDir, 'subusers.db'),  autoload: true }),
  coupons:   Datastore.create({ filename: path.join(dataDir, 'coupons.db'),   autoload: true }),
  redeems:   Datastore.create({ filename: path.join(dataDir, 'redeems.db'),   autoload: true }),
};

db.users.ensureIndex({ fieldName: 'username', unique: true });
db.users.ensureIndex({ fieldName: 'email',    unique: true });
db.coupons.ensureIndex({ fieldName: 'code',   unique: true });

async function seed() {
  const adminExists = await db.users.findOne({ username: 'admin' });
  if (!adminExists) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.users.insert({
      username: 'admin', email: 'admin@kroxy.local',
      password: hash,
      kxy: 9999,          // coins = kxy
      isAdmin: true, isBanned: false,
      lastDailyReward: null,
      lastAfkReward: null,
      // resource limits (can be overridden by coupon)
      maxRamMB: 4096,
      maxDiskGB: 20,
      maxCpuPct: 200,
      maxServers: 3,
      createdAt: new Date(),
    });
    console.log('\x1b[33m  Created default admin: admin / admin123\x1b[0m');
  }

  const regSetting = await db.settings.findOne({ key: 'registration_enabled' });
  if (!regSetting) {
    await db.settings.insert({ key: 'registration_enabled',  value: true });
    await db.settings.insert({ key: 'max_servers_per_user',  value: 3 });
    await db.settings.insert({ key: 'maintenance_mode',      value: false });
    await db.settings.insert({ key: 'daily_reward_kxy',      value: 50 });
    await db.settings.insert({ key: 'afk_reward_kxy',        value: 5 });
    await db.settings.insert({ key: 'afk_interval_sec',      value: 60 });
    await db.settings.insert({ key: 'panel_name',            value: 'Kroxy' });
    await db.settings.insert({ key: 'default_max_ram',       value: 2048 });
    await db.settings.insert({ key: 'default_max_disk',      value: 10 });
    await db.settings.insert({ key: 'default_max_cpu',       value: 100 });
    await db.settings.insert({ key: 'default_max_servers',   value: 3 });
  }

  const nodeExists = await db.nodes.findOne({ name: 'Node-1' });
  if (!nodeExists) {
    await db.nodes.insert({
      name: 'Node-1', region: 'Local',
      ip: '127.0.0.1', fqdn: 'localhost',
      maxServers: 10, daemonPort: 3002,
      totalDiskGB: 50, totalRamMB: 4096, totalCpuPct: 400,
      cfEnabled: false, cfTunnelUrl: '', cfPublicHostname: '',
      status: 'online', createdAt: new Date(),
    });
    console.log('\x1b[33m  Created default node: Node-1\x1b[0m');
  }
}

seed().catch(console.error);
module.exports = db;
