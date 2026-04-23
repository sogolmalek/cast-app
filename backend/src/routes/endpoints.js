import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { generateEndpoint, iterateEndpoint } from '../services/generator.js';
import { executeEndpoint, validateInput } from '../services/runtime.js';

const router = Router();

// GET /api/endpoints — List user's endpoints
router.get('/', authenticate, (req, res) => {
  const endpoints = db.prepare(`
    SELECT id, slug, title, description, price_per_call, status, version,
           total_calls, total_revenue, created_at, updated_at
    FROM endpoints WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(req.user.id);

  res.json({ endpoints });
});

// GET /api/endpoints/:id — Get endpoint details
router.get('/:id', authenticate, (req, res) => {
  const endpoint = db.prepare(`
    SELECT * FROM endpoints WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);

  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

  const versions = db.prepare(`
    SELECT id, version, prompt, created_at FROM endpoint_versions
    WHERE endpoint_id = ? ORDER BY version DESC
  `).all(endpoint.id);

  const recentCalls = db.prepare(`
    SELECT id, caller_address, chain, amount, response_status, latency_ms, created_at
    FROM call_logs WHERE endpoint_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(endpoint.id);

  res.json({
    endpoint: {
      ...endpoint,
      input_schema: JSON.parse(endpoint.input_schema || '{}'),
      output_schema: JSON.parse(endpoint.output_schema || '{}'),
    },
    versions,
    recentCalls,
  });
});

// POST /api/endpoints/generate — Generate a new endpoint from NL
router.post('/generate', authenticate, async (req, res) => {
  const { prompt, conversationId } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Get user's Claude API key
  const user = db.prepare('SELECT claude_api_key_encrypted FROM users WHERE id = ?').get(req.user.id);
  if (!user?.claude_api_key_encrypted) {
    return res.status(400).json({ error: 'Claude API key required. Add your key in Settings.' });
  }

  try {
    // Get conversation history if continuing
    let history = [];
    let conversation;
    if (conversationId) {
      conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
        .get(conversationId, req.user.id);
      if (conversation) {
        history = JSON.parse(conversation.messages || '[]');
      }
    }

    // Generate endpoint code
    const spec = await generateEndpoint(prompt, user.claude_api_key_encrypted, history);

    // Create or update conversation
    const convId = conversationId || uuid();
    const newMessages = [
      ...history,
      { role: 'user', content: prompt },
      { role: 'assistant', content: spec.assistantMessage },
    ];

    if (conversationId && conversation) {
      db.prepare('UPDATE conversations SET messages = ?, updated_at = datetime("now") WHERE id = ?')
        .run(JSON.stringify(newMessages), convId);
    } else {
      db.prepare('INSERT INTO conversations (id, user_id, messages, status) VALUES (?, ?, ?, ?)')
        .run(convId, req.user.id, JSON.stringify(newMessages), 'active');
    }

    res.json({
      conversationId: convId,
      spec: {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        outputSchema: spec.outputSchema,
        code: spec.code,
      },
    });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/endpoints/iterate — Iterate on an existing endpoint
router.post('/iterate', authenticate, async (req, res) => {
  const { instruction, currentCode, conversationId } = req.body;
  if (!instruction || !currentCode) {
    return res.status(400).json({ error: 'Instruction and currentCode are required' });
  }

  const user = db.prepare('SELECT claude_api_key_encrypted FROM users WHERE id = ?').get(req.user.id);
  if (!user?.claude_api_key_encrypted) {
    return res.status(400).json({ error: 'Claude API key required' });
  }

  try {
    let history = [];
    if (conversationId) {
      const conv = db.prepare('SELECT messages FROM conversations WHERE id = ? AND user_id = ?')
        .get(conversationId, req.user.id);
      if (conv) history = JSON.parse(conv.messages || '[]');
    }

    const spec = await iterateEndpoint(instruction, currentCode, user.claude_api_key_encrypted, history);

    // Update conversation
    if (conversationId) {
      const newMessages = [
        ...history,
        { role: 'user', content: instruction },
        { role: 'assistant', content: spec.assistantMessage },
      ];
      db.prepare('UPDATE conversations SET messages = ?, updated_at = datetime("now") WHERE id = ?')
        .run(JSON.stringify(newMessages), conversationId);
    }

    res.json({
      conversationId,
      spec: {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        outputSchema: spec.outputSchema,
        code: spec.code,
      },
    });
  } catch (err) {
    console.error('Iteration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/endpoints/deploy — Deploy a generated endpoint
router.post('/deploy', authenticate, (req, res) => {
  const { title, description, prompt, code, inputSchema, outputSchema, pricePerCall, conversationId } = req.body;
  if (!title || !code) {
    return res.status(400).json({ error: 'Title and code are required' });
  }

  const id = uuid();
  const slug = nanoid(10);

  db.prepare(`
    INSERT INTO endpoints (id, slug, user_id, title, description, prompt, generated_code, input_schema, output_schema, price_per_call)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, slug, req.user.id,
    title,
    description || '',
    prompt || '',
    code,
    JSON.stringify(inputSchema || {}),
    JSON.stringify(outputSchema || {}),
    pricePerCall || 0.001,
  );

  // Save version
  db.prepare('INSERT INTO endpoint_versions (id, endpoint_id, version, prompt, generated_code) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), id, 1, prompt || '', code);

  // Link conversation
  if (conversationId) {
    db.prepare('UPDATE conversations SET endpoint_id = ?, status = ? WHERE id = ?')
      .run(id, 'deployed', conversationId);
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.status(201).json({
    endpoint: {
      id,
      slug,
      url: `${baseUrl}/cast/${slug}`,
      title,
      description,
      pricePerCall: pricePerCall || 0.001,
      status: 'active',
    },
  });
});

// PUT /api/endpoints/:id — Update endpoint (pause, archive, update price)
router.put('/:id', authenticate, (req, res) => {
  const endpoint = db.prepare('SELECT * FROM endpoints WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

  const { status, pricePerCall, code, title, description } = req.body;
  const updates = [];
  const values = [];

  if (status) { updates.push('status = ?'); values.push(status); }
  if (pricePerCall !== undefined) { updates.push('price_per_call = ?'); values.push(pricePerCall); }
  if (title) { updates.push('title = ?'); values.push(title); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (code) {
    updates.push('generated_code = ?', 'version = version + 1');
    values.push(code);
    // Save version
    db.prepare('INSERT INTO endpoint_versions (id, endpoint_id, version, prompt, generated_code) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), endpoint.id, endpoint.version + 1, '', code);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  updates.push('updated_at = datetime("now")');
  values.push(endpoint.id, req.user.id);

  db.prepare(`UPDATE endpoints SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
  res.json({ success: true });
});

// DELETE /api/endpoints/:id
router.delete('/:id', authenticate, (req, res) => {
  const result = db.prepare('DELETE FROM endpoints WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Endpoint not found' });
  res.json({ success: true });
});

// POST /api/endpoints/:id/test — Test an endpoint without payment
router.post('/:id/test', authenticate, async (req, res) => {
  const endpoint = db.prepare('SELECT * FROM endpoints WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

  const inputSchema = JSON.parse(endpoint.input_schema || '{}');
  const errors = validateInput(req.body, inputSchema);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Invalid input', details: errors });
  }

  const result = await executeEndpoint(endpoint.generated_code, req.body, {
    endpoint_id: endpoint.id,
    caller: 'test',
    timestamp: new Date().toISOString(),
  });

  res.json(result);
});

// GET /api/endpoints/:id/analytics
router.get('/:id/analytics', authenticate, (req, res) => {
  const endpoint = db.prepare('SELECT id FROM endpoints WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

  const { days = 30 } = req.query;

  const dailyCalls = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as calls, SUM(amount) as revenue,
           AVG(latency_ms) as avg_latency
    FROM call_logs
    WHERE endpoint_id = ? AND created_at >= datetime('now', '-${parseInt(days)} days')
    GROUP BY date(created_at)
    ORDER BY date
  `).all(endpoint.id);

  const topCallers = db.prepare(`
    SELECT caller_address, COUNT(*) as calls, SUM(amount) as total_spent
    FROM call_logs WHERE endpoint_id = ?
    GROUP BY caller_address ORDER BY calls DESC LIMIT 10
  `).all(endpoint.id);

  const chainBreakdown = db.prepare(`
    SELECT chain, COUNT(*) as calls, SUM(amount) as revenue
    FROM call_logs WHERE endpoint_id = ?
    GROUP BY chain
  `).all(endpoint.id);

  res.json({ dailyCalls, topCallers, chainBreakdown });
});

export default router;
