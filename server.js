const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURATION - YOU NEED TO FILL THESE IN
// ============================================
const config = {
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
};

// ADMIN CONFIGURATION - Add admin email addresses here
const ADMIN_EMAILS = [
  'gclefdominguez5@gmail.com', // Replace with your actual admin Gmail
  'ggclefthedragon10@gmail.com' // Add more admins as needed
];

// In-memory storage (replace with database in production)
const votes = {
  c1: 0, c2: 0, c3: 0, c4: 0, c5: 0
};
const votedUsers = {}; // {email: candidateId}

let candidates = [
  { id: 'c1', name: 'Kiel Abalajos', desc: 'For President' },
  { id: 'c2', name: 'Symon Pena', desc: 'For Vice President' },
  { id: 'c3', name: 'Josh Sumido', desc: 'For Secretary' },
  { id: 'c4', name: 'Gclef dominguez', desc: 'For Auditor' },
  { id: 'c5', name: 'Zhyke Dela Cruz', desc: 'For Treasurer' }
];

let votingEnabled = true; // Admin can enable/disable voting

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true, // Add this for Render/production environments
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Check if user is admin
function isAdmin(email) {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// Middleware to check admin access
function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!isAdmin(req.user.email)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ============================================
// PASSPORT GOOGLE SETUP
// ============================================
passport.use(new GoogleStrategy({
    clientID: config.clientID,
    clientSecret: config.clientSecret,
    callbackURL: config.callbackURL
  },
  (accessToken, refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      photo: profile.photos[0].value
    };
    return done(null, user);
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ============================================
// AUTHENTICATION ROUTES
// ============================================
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    console.log('User authenticated:', req.user);
    console.log('Is admin?', req.user ? ADMIN_EMAILS.includes(req.user.email) : false);
    
    // Save session before redirecting
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect('/');
      }
      
      // Redirect based on admin status
      if (isAdmin(req.user.email)) {
        res.redirect('/admin');
      } else {
        res.redirect('/');
      }
    });
  }
);

app.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

// ============================================
// API ROUTES
// ============================================
app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ 
      authenticated: true, 
      user: req.user,
      hasVoted: !!votedUsers[req.user.email],
      isAdmin: isAdmin(req.user.email)
    });
  } else {
    res.json({ authenticated: false });
  }
});

app.get('/api/candidates', (req, res) => {
  const candidatesWithVotes = candidates.map(c => ({
    ...c,
    votes: votes[c.id] || 0
  }));
  res.json({
    candidates: candidatesWithVotes,
    votingEnabled: votingEnabled
  });
});

app.post('/api/vote', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!votingEnabled) {
    return res.status(400).json({ error: 'Voting is currently disabled' });
  }

  const { candidateId } = req.body;
  const userEmail = req.user.email;

  if (votedUsers[userEmail]) {
    return res.status(400).json({ error: 'You have already voted' });
  }

  if (!votes.hasOwnProperty(candidateId)) {
    return res.status(400).json({ error: 'Invalid candidate' });
  }

  votes[candidateId]++;
  votedUsers[userEmail] = candidateId;

  res.json({ success: true, message: 'Vote recorded!' });
});

app.get('/api/results', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json(votes);
});

app.get('/adminlogin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'adminlogin.html'));
});

// ============================================
// ADMIN ROUTES
// ============================================

// Get admin dashboard data
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const totalVoters = Object.keys(votedUsers).length;
  
  res.json({
    totalVotes,
    totalVoters,
    votingEnabled,
    candidates: candidates.map(c => ({
      ...c,
      votes: votes[c.id] || 0,
      percentage: totalVotes > 0 ? ((votes[c.id] / totalVotes) * 100).toFixed(1) : 0
    })),
    voters: Object.entries(votedUsers).map(([email, candidateId]) => ({
      email,
      votedFor: candidates.find(c => c.id === candidateId)?.name
    }))
  });
});

// Toggle voting on/off
app.post('/api/admin/toggle-voting', requireAdmin, (req, res) => {
  votingEnabled = !votingEnabled;
  res.json({ success: true, votingEnabled });
});

// Reset all votes
app.post('/api/admin/reset-votes', requireAdmin, (req, res) => {
  Object.keys(votes).forEach(key => votes[key] = 0);
  Object.keys(votedUsers).forEach(key => delete votedUsers[key]);
  res.json({ success: true, message: 'All votes have been reset' });
});

// Add candidate
app.post('/api/admin/add-candidate', requireAdmin, (req, res) => {
  const { name, desc } = req.body;
  if (!name || !desc) {
    return res.status(400).json({ error: 'Name and description required' });
  }
  
  const newId = 'c' + (candidates.length + 1);
  const newCandidate = { id: newId, name, desc };
  candidates.push(newCandidate);
  votes[newId] = 0;
  
  res.json({ success: true, candidate: newCandidate });
});

// Update candidate
app.put('/api/admin/update-candidate/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, desc } = req.body;
  
  const candidate = candidates.find(c => c.id === id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  
  if (name) candidate.name = name;
  if (desc) candidate.desc = desc;
  
  res.json({ success: true, candidate });
});

// Delete candidate
app.delete('/api/admin/delete-candidate/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const index = candidates.findIndex(c => c.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  
  candidates.splice(index, 1);
  delete votes[id];
  
  // Remove votes for this candidate
  Object.keys(votedUsers).forEach(email => {
    if (votedUsers[email] === id) {
      delete votedUsers[email];
    }
  });
  
  res.json({ success: true, message: 'Candidate deleted' });
});

// Export results as JSON
app.get('/api/admin/export', requireAdmin, (req, res) => {
  const exportData = {
    exportDate: new Date().toISOString(),
    totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
    candidates: candidates.map(c => ({
      name: c.name,
      position: c.desc,
      votes: votes[c.id] || 0
    })),
    voters: Object.entries(votedUsers).map(([email, candidateId]) => ({
      email,
      votedFor: candidates.find(c => c.id === candidateId)?.name
    }))
  };
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=voting-results.json');
  res.json(exportData);
});

// ============================================
// SERVE FRONTEND
// ============================================
app.use(express.static('public'));

// Home route - serves voting page for authenticated users, login for non-authenticated
app.get('/', (req, res) => {
  if (!req.isAuthenticated()) {
    // Not logged in, show login page (you might need a separate login.html or use index.html)
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  
  // User is authenticated - check if admin
  if (isAdmin(req.user.email)) {
    return res.redirect('/admin');
  }
  
  // Regular user - show voting page
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin route - only for authenticated admins
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log('📧 Admin emails:', ADMIN_EMAILS);
  console.log('🔗 Voting page: http://localhost:3000');
  console.log('🔐 Admin panel: http://localhost:3000/admin');
});