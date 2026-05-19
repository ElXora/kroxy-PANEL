const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!res.locals.user || !res.locals.user.isAdmin) {
    req.flash('error', 'Access denied.');
    return res.redirect('/dashboard');
  }
  next();
};

module.exports = { requireAuth, requireAdmin };
