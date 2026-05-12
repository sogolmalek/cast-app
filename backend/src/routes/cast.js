import { Router } from 'express';
import db from '../db.js';
import { x402Gate, logCall } from '../middleware/x402.js';
import { executeEndpoint, validateInput } from '../services/runtime.js';
import { listChains, getVerifier } from '../adapters/index.js';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const router = Router();

// Rate limit for cast endpoint calls
const castRateLimit = rateLimit({
  windowMs: config.rateLimit.castCallWindowMs,
  max: config.rateLimit.castCallMaxRequests,
  keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip,
  message: { error: 'Too many requests. Please try again later.' },
});

// GET /cast — API directory (public)
router.get('/', (req, res) => {
  const endpoints = db.prepare(`
    SELECT slug, title, description, price_per_call, total_calls, input_schema, output_schema
    FROM endpoints WHERE status = 'active'
    ORDER BY total_calls DESC LIMIT 100
  `).all();

  res.json({
    name: 'Cast API Directory',
    version: '1.0',
    description: 'The instant API layer for the AI agent economy',
    supportedChains: listChains(),
    payment: {
      protocol: 'x402',
      currency: 'AUDD',
      defaultPrice: '$0.001 per call (settled in AUDD, USDC, or USDT depending on chain)',
    },
    endpoints: endpoints.map(e => ({
      url: `/cast/${e.slug}`,
      title: e.title,
      description: e.description,
      pricePerCall: e.price_per_call,
      totalCalls: e.total_calls,
      inputSchema: JSON.parse(e.input_schema || '{}'),
      outputSchema: JSON.parse(e.output_schema || '{}'),
    })),
  });
});

// GET /cast/chains — Chain info + payment construction helpers (public)
router.get('/chains', (req, res) => {
  const chains = listChains();
  res.json({
    supported: chains,
    paymentProtocol: 'x402',
    headerFormat: {
      name: 'X-Payment',
      encoding: 'base64',
      payload: {
        chain: 'string — one of: ' + chains.map(c => c.chainId).join(', '),
        proof: 'string — tx hash (0x...) or signed authorization JSON',
        payer: 'string — caller wallet address',
        amount: 'string — amount in smallest unit (USDC: 6 decimals)',
        nonce: 'string — unique nonce for replay protection',
      },
    },
  });
});

// GET /cast/chains/solana/payment-intent/:slug — Payment intent template for Solana callers
// Returns everything a caller needs to build and sign an AUDD transfer:
// mint, recipient ATA owner, amount, and the exact X-Payment payload to send back.
router.get('/chains/solana/payment-intent/:slug', (req, res) => {
  try {
    const endpoint = db.prepare(`
      SELECT slug, price_per_call FROM endpoints WHERE slug = ? AND status = 'active'
    `).get(req.params.slug);

    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    const verifier = getVerifier('solana');
    const meta = verifier.getPaymentMeta();
    const amountSmallestUnit = String(Math.round(endpoint.price_per_call * 10 ** (meta.auddDecimals || 6)));

    res.json({
      description: 'Build an AUDD transfer on Solana that matches this intent, then submit its signature in the X-Payment header',
      instructions: [
        '1. Transfer AUDD (SPL token) from your wallet to the recipient below',
        '2. Wait for the transaction to be confirmed',
        '3. Base64-encode the payment JSON below with your tx signature and send it as X-Payment',
      ],
      intent: {
        chain: 'solana',
        network: meta.network,
        auddMint: meta.auddMint,
        auddDecimals: meta.auddDecimals,
        recipient: verifier.getRecipientAddress(),
        amount: amountSmallestUnit,
        amountUi: endpoint.price_per_call,
        currency: 'AUDD',
      },
      paymentHeader: {
        format: 'base64 encoded JSON',
        example: {
          chain: 'solana',
          proof: '<base58 tx signature of your confirmed AUDD transfer>',
          payer: '<your Solana wallet address>',
          amount: amountSmallestUnit,
          nonce: '<unique nonce string>',
        },
      },
    });
  } catch (err) {
    console.error('[cast/chains/solana/payment-intent]', err.message);
    res.status(500).json({ error: 'Failed to generate payment intent', details: err.message });
  }
});

// GET /cast/:slug — Endpoint documentation (public)
router.get('/:slug', (req, res) => {
  // Skip reserved paths
  if (req.params.slug === 'chains') return res.status(404).json({ error: 'Use /cast/chains' });

  const endpoint = db.prepare(`
    SELECT slug, title, description, price_per_call, input_schema, output_schema, total_calls
    FROM endpoints WHERE slug = ? AND status = 'active'
  `).get(req.params.slug);

  if (!endpoint) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.json({
    url: `${baseUrl}/cast/${endpoint.slug}`,
    title: endpoint.title,
    description: endpoint.description,
    pricePerCall: endpoint.price_per_call,
    currency: 'AUDD',
    totalCalls: endpoint.total_calls,
    inputSchema: JSON.parse(endpoint.input_schema || '{}'),
    outputSchema: JSON.parse(endpoint.output_schema || '{}'),
    usage: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': '<base64 encoded payment proof>',
      },
      body: 'JSON object matching inputSchema',
    },
    paymentExample: {
      description: 'Base64 encode this JSON as the X-Payment header',
      payload: {
        chain: 'solana',
        proof: '<base58 tx signature of your confirmed AUDD transfer>',
        payer: '<your Solana wallet address>',
        amount: String(Math.round(endpoint.price_per_call * 1_000_000)),
        nonce: '<unique nonce>',
      },
    },
  });
});

// POST /cast/:slug — Execute endpoint (requires x402 payment)
router.post('/:slug',
  castRateLimit,
  // Load endpoint
  (req, res, next) => {
    const endpoint = db.prepare(`
      SELECT * FROM endpoints WHERE slug = ? AND status = 'active'
    `).get(req.params.slug);

    if (!endpoint) {
      return res.status(404).json({ error: 'Endpoint not found or not active' });
    }

    req.castEndpoint = endpoint;
    next();
  },
  // x402 payment gate
  x402Gate,
  // Log the call
  logCall,
  // Execute
  async (req, res) => {
    const endpoint = req.castEndpoint;
    const inputSchema = JSON.parse(endpoint.input_schema || '{}');

    // Validate input
    const errors = validateInput(req.body, inputSchema);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Invalid input', details: errors });
    }

    // Execute the endpoint
    const result = await executeEndpoint(endpoint.generated_code, req.body, {
      endpoint_id: endpoint.id,
      caller: req.paymentMeta?.payer || 'unknown',
      timestamp: new Date().toISOString(),
    });

    if (!result.success) {
      return res.status(500).json({
        error: 'Endpoint execution failed',
        details: result.error,
        executionMs: result.executionMs,
      });
    }

    res.json({
      data: result.result,
      meta: {
        endpoint: endpoint.slug,
        executionMs: result.executionMs,
        chain: req.paymentMeta?.chain,
        txHash: req.paymentMeta?.txHash,
      },
    });
  }
);

export default router;
