import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import db from '../db.js';
import { generateToken, authenticate } from '../middleware/auth.js';

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = signupSchema.parse(req.body);

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, 12);

    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, passwordHash);

    // Create default aggregate balance
    db.prepare('INSERT INTO balances (id, user_id, chain, amount) VALUES (?, ?, ?, ?)').run(uuid(), id, 'aggregate', 0);

    const token = generateToken({ id, email });
    res.status(201).json({ token, user: { id, email } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken({ id: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, claude_api_key_encrypted, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: user.id,
    email: user.email,
    hasClaudeKey: !!user.claude_api_key_encrypted,
    createdAt: user.created_at,
  });
});

// PUT /api/auth/claude-key
router.put('/claude-key', authenticate, (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'API key is required' });
  }

  // In production: encrypt the key before storing
  // For now: store as-is (should use AES-256-GCM with a server-side key)
  db.prepare('UPDATE users SET claude_api_key_encrypted = ?, updated_at = datetime("now") WHERE id = ?')
    .run(apiKey, req.user.id);

  res.json({ success: true, message: 'Claude API key saved' });
});

// DELETE /api/auth/claude-key
router.delete('/claude-key', authenticate, (req, res) => {
  db.prepare('UPDATE users SET claude_api_key_encrypted = NULL, updated_at = datetime("now") WHERE id = ?')
    .run(req.user.id);

  res.json({ success: true, message: 'Claude API key removed' });
});

export default router;
