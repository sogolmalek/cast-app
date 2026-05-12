import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { getVerifier, listChains } from '../adapters/index.js';

const router = Router();

// GET /api/balance — Get user's balance across all chains
router.get('/', authenticate, (req, res) => {
  const balances = db.prepare(`
    SELECT chain, amount, pending_amount, updated_at
    FROM balances WHERE user_id = ?
  `).all(req.user.id);

  const totalBalance = balances.reduce((sum, b) => sum + b.amount, 0);
  const totalPending = balances.reduce((sum, b) => sum + b.pending_amount, 0);

  res.json({
    total: {
      available: Math.round(totalBalance * 1_000_000) / 1_000_000,
      pending: Math.round(totalPending * 1_000_000) / 1_000_000,
      currency: 'USDC',
    },
    balances,
    supportedChains: listChains(),
  });
});

// GET /api/balance/history — Earnings history
router.get('/history', authenticate, (req, res) => {
  const { days = 30 } = req.query;

  const dailyEarnings = db.prepare(`
    SELECT date(cl.created_at) as date, SUM(cl.amount) as earnings, COUNT(*) as calls
    FROM call_logs cl
    JOIN endpoints e ON cl.endpoint_id = e.id
    WHERE e.user_id = ? AND cl.created_at >= datetime('now', '-${parseInt(days)} days')
    GROUP BY date(cl.created_at)
    ORDER BY date
  `).all(req.user.id);

  const totalEarnings = db.prepare(`
    SELECT SUM(cl.amount) as total
    FROM call_logs cl
    JOIN endpoints e ON cl.endpoint_id = e.id
    WHERE e.user_id = ?
  `).get(req.user.id);

  res.json({
    dailyEarnings,
    totalAllTime: totalEarnings?.total || 0,
  });
});

// POST /api/balance/withdraw — Request a withdrawal
router.post('/withdraw', authenticate, async (req, res) => {
  const { chain, amount, destinationAddress } = req.body;

  if (!chain || !amount || !destinationAddress) {
    return res.status(400).json({ error: 'chain, amount, and destinationAddress are required' });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  // Minimum withdrawal: $0.10
  if (amount < 0.10) {
    return res.status(400).json({ error: 'Minimum withdrawal is $0.10 USDC' });
  }

  // Check available balance
  const balance = db.prepare(`
    SELECT amount FROM balances WHERE user_id = ? AND chain = 'aggregate'
  `).get(req.user.id);

  if (!balance || balance.amount < amount) {
    return res.status(400).json({
      error: 'Insufficient balance',
      available: balance?.amount || 0,
      requested: amount,
    });
  }

  // Deduct from balance
  const withdrawalId = uuid();
  const deductAndCreate = db.transaction(() => {
    db.prepare(`
      UPDATE balances SET amount = amount - ?, pending_amount = pending_amount + ?, updated_at = datetime('now')
      WHERE user_id = ? AND chain = 'aggregate'
    `).run(amount, amount, req.user.id);

    db.prepare(`
      INSERT INTO withdrawals (id, user_id, chain, amount, destination_address, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(withdrawalId, req.user.id, chain, amount, destinationAddress);
  });

  try {
    deductAndCreate();

    // In production: queue the withdrawal for processing
    // For now: attempt immediate settlement
    processWithdrawal(withdrawalId, chain).catch(err => {
      console.error('Withdrawal processing failed:', err);
    });

    res.json({
      withdrawal: {
        id: withdrawalId,
        chain,
        amount,
        destinationAddress,
        status: 'pending',
      },
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

// GET /api/balance/withdrawals — List withdrawal history
router.get('/withdrawals', authenticate, (req, res) => {
  const withdrawals = db.prepare(`
    SELECT id, chain, amount, destination_address, tx_hash, status, created_at, completed_at
    FROM withdrawals WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);

  res.json({ withdrawals });
});

/**
 * Process a withdrawal (async, runs in background)
 */
async function processWithdrawal(withdrawalId, chain) {
  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
  if (!withdrawal) return;

  db.prepare("UPDATE withdrawals SET status = 'processing' WHERE id = ?").run(withdrawalId);

  try {
    const verifier = getVerifier(chain);
    const result = await verifier.settle({
      from: verifier.getRecipientAddress(),
      to: withdrawal.destination_address,
      amount: String(Math.round(withdrawal.amount * 1_000_000)),
    });

    if (result.status === 'completed') {
      db.prepare(`
        UPDATE withdrawals SET status = 'completed', tx_hash = ?, completed_at = datetime('now') WHERE id = ?
      `).run(result.txHash, withdrawalId);

      // Remove from pending
      db.prepare(`
        UPDATE balances SET pending_amount = pending_amount - ?, updated_at = datetime('now')
        WHERE user_id = ? AND chain = 'aggregate'
      `).run(withdrawal.amount, withdrawal.user_id);
    } else {
      throw new Error('Settlement failed');
    }
  } catch (err) {
    console.error('Settlement failed:', err);
    // Refund to available balance
    db.prepare(`
      UPDATE balances SET amount = amount + ?, pending_amount = pending_amount - ?, updated_at = datetime('now')
      WHERE user_id = ? AND chain = 'aggregate'
    `).run(withdrawal.amount, withdrawal.amount, withdrawal.user_id);
    db.prepare("UPDATE withdrawals SET status = 'failed' WHERE id = ?").run(withdrawalId);
  }
}

export default router;
