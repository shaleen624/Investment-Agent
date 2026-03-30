const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDb } = require('../../db');

const router = express.Router();

// Register endpoint
router.post('/register', async (req, res) => {
  const db = getDb();
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const email = req.body.email || `${username}@example.com`;

    // Insert new user
    const result = db.prepare(
      "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(username, email, hashedPassword);

    const userId = Number(result.lastInsertRowid);

    // Generate JWT token
    const token = jwt.sign(
      { userId, username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Store session
    db.prepare(
      "INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+24 hours'))"
    ).run(userId, token);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: userId, username }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  const db = getDb();
  try {
    const { username, password } = req.body;

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
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Store session
    db.prepare(
      "INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+24 hours'))"
    ).run(user.id, token);

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      run('DELETE FROM user_sessions WHERE token = ?', [token]);
    }
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token endpoint (for frontend to check if token is still valid)
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

    // Check if session exists and is not expired
    const session = get(
      'SELECT id FROM user_sessions WHERE token = ? AND expires_at > datetime("now")',
      [token]
    );

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.json({ valid: true, user: { id: decoded.userId, username: decoded.username } });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;