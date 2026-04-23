import { Router } from 'express';
import db from '../db.js';
import { x402Gate, logCall } from '../middleware/x402.js';
import { executeEndpoint, validateInput } from '../services/runtime.js';
import { listChains, getVerifier } from '../adapters/index.js';
import { buildPaymentTypedData, usdcToUint256 } from '../adapters/starknet-constants.js';
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
      currency: 'USDC',
      defaultPrice: '$0.001 per call',
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

// GET /cast/chains/starknet/typed-data/:slug — SNIP-12 typed data template for off-chain signing
router.get('/chains/starknet/typed-data/:slug', (req, res) => {
  try {
    const endpoint = db.prepare(`
      SELECT slug, price_per_call FROM endpoints WHERE slug = ? AND status = 'active'
    `).get(req.params.slug);

    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    const verifier = getVerifier('starknet');
    const amountUint256 = usdcToUint256(endpoint.price_per_call);
    const paymentContract = config.starknet.paymentContractAddress || '0x0000000000000000000000000000000000000000000000000000000000000000';

    res.json({
      description: 'Sign this SNIP-12 message with your Starknet wallet to authorize payment',
      instructions: [
        '1. Replace PLACEHOLDER values (endpoint_id, your address, nonce, deadline)',
        '2. Sign with your wallet (ArgentX, Braavos, etc.)',
        '3. Send the signature in the X-Payment header as signed authorization JSON',
      ],
      typedData: buildPaymentTypedData(
        config.starknet.chainId || 'SN_MAIN',
        paymentContract,
        {
          endpointId: 'PLACEHOLDER_ENDPOINT_ID',
          creator: verifier.getRecipientAddress() || paymentContract,
          amountLow: amountUint256.low,
          amountHigh: amountUint256.high,
          nonce: 'PLACEHOLDER_UNIQUE_NONCE',
          deadline: 'PLACEHOLDER_UNIX_TIMESTAMP',
        },
      ),
      paymentHeader: {
        format: 'base64 encoded JSON',
        example: {
          chain: 'starknet',
          proof: JSON.stringify({
            signature: ['0x...r', '0x...s'],
            endpointId: 'PLACEHOLDER',
            creator: paymentContract,
            deadline: String(Math.floor(Date.now() / 1000) + 3600),
          }),
          payer: '0x_your_wallet_address',
          amount: String(Math.round(endpoint.price_per_call * 1_000_000)),
          nonce: 'unique_nonce_here',
        },
      },
    });
  } catch (err) {
    console.error('[cast/chains/starknet/typed-data]', err.message);
    res.status(500).json({ error: 'Failed to generate typed data', details: err.message });
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
    currency: 'USDC',
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
        chain: 'starknet',
        proof: '<transaction hash or signed payload>',
        payer: '<your wallet address>',
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
