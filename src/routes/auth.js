const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { pageTitle: 'Login — KRYOXI', layout: 'auth' });
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { pageTitle: 'Login — KRYOXI', layout: 'auth' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('error', 'Fill in all fields.');
    return res.redirect('/login');
  }
  try {
    const user = await db.users.findOne({ $or: [{ username }, { email: username }] });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      req.flash('error', 'Invalid credentials.');
      return res.redirect('/login');
    }
    if (user.isBanned) {
      req.flash('error', 'Your account has been suspended.');
      return res.redirect('/login');
    }
    req.session.userId = user._id;
    res.redirect('/dashboard');
  } catch (e) {
    req.flash('error', 'Login failed. Try again.');
    res.redirect('/login');
  }
});

router.get('/register', async (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  const setting = await db.settings.findOne({ key: 'registration_enabled' });
  if (!setting || !setting.value) {
    req.flash('error', 'Registration is currently disabled.');
    return res.redirect('/login');
  }
  res.render('auth/register', { pageTitle: 'Register — KRYOXI', layout: 'auth' });
});

router.post('/register', async (req, res) => {
  const { username, email, password, confirm_password } = req.body;
  if (!username || !email || !password) {
    req.flash('error', 'Fill in all fields.');
    return res.redirect('/register');
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    req.flash('error', 'Username: 3-20 chars, letters/numbers/underscores only.');
    return res.redirect('/register');
  }
  if (password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect('/register');
  }
  if (password !== confirm_password) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('/register');
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.users.insert({
      username, email, password: hash,
      coins: 100, isAdmin: false, isBanned: false,
      lastDailyReward: null, createdAt: new Date(),
    });
    req.flash('success', 'Account created! Log in now.');
    res.redirect('/login');
  } catch (e) {
    req.flash('error', 'Username or email already taken.');
    res.redirect('/register');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
