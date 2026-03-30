const { getDb } = require('./src/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

async function test() {
  const db = getDb();
  try {
    const username = 'shaleen624';
    console.log('Querying DB...');
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    if (!user) {
      console.log('User not found.');
      return;
    }
    console.log('User found:', user.id, user.username);
    console.log('Verifying password...');
    const isValid = await bcrypt.compare('testPass@123', user.password_hash);
    console.log('Password valid:', isValid);
    
    const token = jwt.sign({ userId: user.id, username, jti: randomUUID() }, 'secret', { expiresIn: '24h' });
    console.log('Token created');
    db.prepare("INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+24 hours'))").run(user.id, token);
    console.log('Session inserted');
  } catch (err) {
    console.error('Error:', err);
  }
}
test();
