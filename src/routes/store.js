const express = require('express');
const router = express.Router();
const db = require('../db');

// Store items config
const STORE_ITEMS = [
  { id: 'ram_512',    name: '512MB RAM',        type: 'ram',     amount: 512,  price: 800,   unit: 'MB',  icon: 'ram' },
  { id: 'ram_1024',   name: '1GB RAM',           type: 'ram',     amount: 1024, price: 1500,  unit: 'MB',  icon: 'ram' },
  { id: 'ram_2048',   name: '2GB RAM',           type: 'ram',     amount: 2048, price: 2800,  unit: 'MB',  icon: 'ram' },
  { id: 'ram_4096',   name: '4GB RAM',           type: 'ram',     amount: 4096, price: 5000,  unit: 'MB',  icon: 'ram' },
  { id: 'disk_5',     name: '5GB Disk',          type: 'disk',    amount: 5,    price: 600,   unit: 'GB',  icon: 'disk' },
  { id: 'disk_10',    name: '10GB Disk',         type: 'disk',    amount: 10,   price: 1100,  unit: 'GB',  icon: 'disk' },
  { id: 'disk_25',    name: '25GB Disk',         type: 'disk',    amount: 25,   price: 2500,  unit: 'GB',  icon: 'disk' },
  { id: 'disk_50',    name: '50GB Disk',         type: 'disk',    amount: 50,   price: 4500,  unit: 'GB',  icon: 'disk' },
  { id: 'cpu_50',     name: '50% CPU',           type: 'cpu',     amount: 50,   price: 700,   unit: '%',   icon: 'cpu' },
  { id: 'cpu_100',    name: '100% CPU (1 core)', type: 'cpu',     amount: 100,  price: 1200,  unit: '%',   icon: 'cpu' },
  { id: 'cpu_200',    name: '200% CPU (2 cores)',type: 'cpu',     amount: 200,  price: 2200,  unit: '%',   icon: 'cpu' },
  { id: 'slot_1',     name: '1 Server Slot',     type: 'servers', amount: 1,    price: 3500,  unit: 'slot',icon: 'server' },
  { id: 'slot_3',     name: '3 Server Slots',    type: 'servers', amount: 3,    price: 9000,  unit: 'slot',icon: 'server' },
  { id: 'slot_5',     name: '5 Server Slots',    type: 'servers', amount: 5,    price: 14000, unit: 'slot',icon: 'server' },
];

router.get('/', async (req, res) => {
  const user = res.locals.user;
  const freshUser = await db.users.findOne({ _id: user._id });
  res.render('store/index', {
    pageTitle: 'Store — Kroxy',
    layout: 'main',
    items: STORE_ITEMS,
    user: freshUser,
  });
});

router.post('/buy', async (req, res) => {
  const { itemId } = req.body;
  const user = await db.users.findOne({ _id: res.locals.user._id });
  const item = STORE_ITEMS.find(i => i.id === itemId);

  if (!item) return res.json({ success: false, message: 'Item not found.' });
  if (item.price > 0 && (user.kxy || 0) < item.price) {
    return res.json({ success: false, message: `Not enough KXY. You need ${item.price} KXY.` });
  }

  const updates = {};
  if (item.price > 0) updates.kxy = (user.kxy || 0) - item.price;

  if (item.type === 'ram')     updates.maxRamMB   = (user.maxRamMB   || 0) + item.amount;
  if (item.type === 'disk')    updates.maxDiskGB  = (user.maxDiskGB  || 0) + item.amount;
  if (item.type === 'cpu')     updates.maxCpuPct  = (user.maxCpuPct  || 0) + item.amount;
  if (item.type === 'servers') updates.maxServers = (user.maxServers || 0) + item.amount;
  if (item.type === 'kxy')     updates.kxy        = (user.kxy        || 0) + item.amount;

  await db.users.update({ _id: user._id }, { $set: updates });
  await db.activity.insert({
    userId: user._id,
    action: 'store_purchase',
    details: `Bought "${item.name}" for ${item.price} KXY`,
    createdAt: new Date(),
  });

  const updatedUser = await db.users.findOne({ _id: user._id });
  return res.json({
    success: true,
    message: `Purchased ${item.name}!`,
    kxy: updatedUser.kxy,
    maxRamMB: updatedUser.maxRamMB,
    maxDiskGB: updatedUser.maxDiskGB,
    maxCpuPct: updatedUser.maxCpuPct,
    maxServers: updatedUser.maxServers,
  });
});

module.exports = router;
