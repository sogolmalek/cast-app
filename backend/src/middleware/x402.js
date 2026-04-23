import { config } from '../config.js';
import { getVerifier } from '../adapters/index.js';
import db from '../db.js';
import { v4 as uuid } from 'uuid';

/**
 * x402 Payment Middleware
 *
 * Implements the HTTP 402 Payment Required flow:
 * 1. Request arrives at a Cast endpoint
 * 2. If no X-Payment header → return 402 with payment requirements
 * 3. If X-Payment header present → parse, verify on-chain, execute endpoint
 * 4. Credit creator balance on successful verification
 *
 * Payment header format:
 * X-Payment: <base64 encoded JSON>
 * {
 *   chain: "starknet" | "base" | "ethereum",
 *   proof: "<chain-specific payment proof>",
 *   payer: "<address>",
 *   amount: "1000", // in smallest unit (e.g., 6 decimals for USDC = 0.001)
 *   nonce: "<unique nonce>"
 * }
 */
export async function x402Gate(req, res, next) {
  const endpoint = req.castEndpoint;
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

  const paymentHeader = req.headers['x-payment'];

  // No payment header → return 402 with payment requirements
  if (!paymentHeader) {
    return res.status(402).json({
      error: 'Payment Required',
      x402: {
        version: '1',
        accepts: config.payment.supportedChains.map(chain => ({
          chain,
          currency: config.payment.currency,
          amount: String(Math.round(endpoint.price_per_call * 1_000_000)), // USDC 6 decimals
          recipient: getVerifier(chain).getRecipientAddress(),
          network: chain === 'starknet' ? 'mainnet' : chain,
        })),
        description: endpoint.title,
        endpoint: `/cast/${endpoint.slug}`,
      }
    });
  }

  // Parse payment proof
  let payment;
  try {
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
    payment = JSON.parse(decoded);
  } catch {
    return res.status(400).json({ error: 'Invalid X-Payment header: malformed payload' });
  }

  // Validate payment fields
  const { chain, proof, payer, amount, nonce } = payment;
  if (!chain || !proof || !payer || !amount || !nonce) {
    return res.status(400).json({
      error: 'Invalid X-Payment: missing required fields',
      required: ['chain', 'proof', 'payer', 'amount', 'nonce']
    });
  }

  if (!config.payment.supportedChains.includes(chain)) {
    return res.status(400).json({
      error: `Unsupported chain: ${chain}`,
      supported: config.payment.supportedChains
    });
  }

  // Check nonce uniqueness (prevent replay)
  // Layer 1: Local DB check (fast)
  const existingCall = db.prepare('SELECT id FROM call_logs WHERE payment_proof = ?').get(nonce);
  if (existingCall) {
    return res.status(409).json({ error: 'Payment nonce already used (replay detected)' });
  }

  // Layer 2: On-chain nonce check for Starknet (non-fatal, 3s timeout)
  const verifier = getVerifier(chain);
  if (chain === 'starknet' && typeof verifier.isNonceUsed === 'function') {
    try {
      const onChainUsed = await Promise.race([
        verifier.isNonceUsed(nonce),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ]);
      if (onChainUsed) {
        return res.status(409).json({ error: 'Payment nonce already used on-chain (replay detected)' });
      }
    } catch (err) {
      console.warn('[x402] On-chain nonce check skipped:', err.message);
    }
  }
  const startTime = Date.now();
  let verified = false;
  let txHash = null;

  try {
    const result = await verifier.verify({
      proof,
      payer,
      amount,
      nonce,
      recipient: verifier.getRecipientAddress(),
    });
    verified = result.verified;
    txHash = result.txHash;
  } catch (err) {
    console.error(`Payment verification failed on ${chain}:`, err.message);
    return res.status(402).json({
      error: 'Payment verification failed',
      details: err.message
    });
  }

  if (!verified) {
    return res.status(402).json({ error: 'Payment not verified on-chain' });
  }

  // Credit creator balance
  const priceUsd = endpoint.price_per_call;
  const creditBalance = db.prepare(`
    INSERT INTO balances (id, user_id, chain, amount, updated_at)
    VALUES (?, ?, 'aggregate', ?, datetime('now'))
    ON CONFLICT(user_id, chain)
    DO UPDATE SET amount = amount + ?, updated_at = datetime('now')
  `);
  creditBalance.run(uuid(), endpoint.user_id, priceUsd, priceUsd);

  // Update endpoint stats
  db.prepare(`
    UPDATE endpoints 
    SET total_calls = total_calls + 1, total_revenue = total_revenue + ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(priceUsd, endpoint.id);

  // Store payment metadata for the call log
  req.paymentMeta = {
    chain,
    payer,
    amount: priceUsd,
    txHash,
    nonce,
    latencyMs: Date.now() - startTime,
  };

  next();
}

/**
 * Middleware to log completed calls
 */
export function logCall(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (req.paymentMeta && req.castEndpoint) {
      try {
        db.prepare(`
          INSERT INTO call_logs (id, endpoint_id, caller_address, chain, payment_proof, tx_hash, amount, request_body, response_body, response_status, latency_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          uuid(),
          req.castEndpoint.id,
          req.paymentMeta.payer,
          req.paymentMeta.chain,
          req.paymentMeta.nonce,
          req.paymentMeta.txHash,
          req.paymentMeta.amount,
          JSON.stringify(req.body || {}),
          JSON.stringify(body),
          res.statusCode,
          req.paymentMeta.latencyMs
        );
      } catch (err) {
        console.error('Failed to log call:', err.message);
      }
    }
    return originalJson(body);
  };
  next();
}
