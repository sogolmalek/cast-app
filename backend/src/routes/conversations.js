import { Router } from 'express';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// GET /api/conversations — List user's conversations
router.get('/', authenticate, (req, res) => {
  const conversations = db.prepare(`
    SELECT c.id, c.endpoint_id, c.status, c.created_at, c.updated_at,
           e.title as endpoint_title, e.slug as endpoint_slug
    FROM conversations c
    LEFT JOIN endpoints e ON c.endpoint_id = e.id
    WHERE c.user_id = ?
    ORDER BY c.updated_at DESC LIMIT 50
  `).all(req.user.id);

  // Get first user message as preview for each conversation
  const results = conversations.map(c => {
    const messages = JSON.parse(db.prepare('SELECT messages FROM conversations WHERE id = ?').get(c.id)?.messages || '[]');
    const firstMsg = messages.find(m => m.role === 'user');
    return {
      ...c,
      preview: firstMsg?.content?.slice(0, 100) || '',
      messageCount: messages.length,
    };
  });

  res.json({ conversations: results });
});

// GET /api/conversations/:id — Get full conversation
router.get('/:id', authenticate, (req, res) => {
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  res.json({
    ...conversation,
    messages: JSON.parse(conversation.messages || '[]'),
  });
});

// DELETE /api/conversations/:id
router.delete('/:id', authenticate, (req, res) => {
  const result = db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ success: true });
});

export default router;
