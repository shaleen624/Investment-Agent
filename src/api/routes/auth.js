const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { getDb } = require('../../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TOKEN_EXPIRY = '24h';

function normalizeUsername(value) {
  return String(value || '').trim();
}

function buildAuthResponse(message, token, userId, username) {
  return {
    message,
    token,
    user: { id: userId, username },
  };
}

function issueToken(userId, username) {
  return jwt.sign(
    { userId, username, jti: randomUUID() },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function createSession(db, userId, token) {
  return db.prepare(
    "INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+24 hours'))"
  ).run(userId, token);
}

function issueTokenAndSession(db, userId, username) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const token = issueToken(userId, username);
      createSession(db, userId, token);
      return token;
    } catch (err) {
      lastErr = err;
      if (!(String(err.message || '').includes('UNIQUE constraint failed: user_sessions.token'))) {
        throw err;
      }
    }
  }
  throw lastErr || new Error('Failed to create session');
}

// Register endpoint
router.post('/register', async (req, res) => {
  const db = getDb();
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const email = String(req.body.email || `${username}@example.com`).trim();

    // Insert new user
    const result = db.prepare(
      "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(username, email, hashedPassword);

    const userId = Number(result.lastInsertRowid);

    // Generate JWT token
    const token = issueTokenAndSession(db, userId, username);
    res.status(201).json(buildAuthResponse('User registered successfully', token, userId, username));
  } catch (error) {
    console.error('Registration error:', error);
    if (String(error.message || '').includes('UNIQUE constraint failed: users.email')) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    if (String(error.message || '').includes('UNIQUE constraint failed: users.username')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  const db = getDb();
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = issueTokenAndSession(db, user.id, user.username);
    res.json(buildAuthResponse('Login successful', token, user.id, user.username));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  const db = getDb();
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
    }
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed. Please try again.' });
  }
});

// Verify token endpoint (for frontend to check if token is still valid)
router.get('/verify', async (req, res) => {
  const db = getDb();
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if session exists and is not expired
    const session = db.prepare(
      'SELECT id FROM user_sessions WHERE token = ? AND expires_at > datetime("now")',
    ).get(token);

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.json({ valid: true, user: { id: decoded.userId, username: decoded.username } });
  } catch (error) {
    console.error('Token verification error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
