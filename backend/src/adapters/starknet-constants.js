/**
 * Starknet Constants — ABIs, selectors, typed data definitions
 *
 * All the on-chain constants Cast needs to interact with:
 * - ERC-20 USDC contract ABI (transfer, transferFrom, balanceOf, approve)
 * - Cast Payment contract ABI
 * - Event selectors (pre-computed)
 * - SNIP-12 typed data for off-chain payment authorization
 */

// ── ERC-20 ABI (subset needed for Cast) ──

export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'recipient', type: 'felt' },
      { name: 'amount', type: 'Uint256' },
    ],
    outputs: [{ name: 'success', type: 'felt' }],
  },
  {
    name: 'transferFrom',
    type: 'function',
    inputs: [
      { name: 'sender', type: 'felt' },
      { name: 'recipient', type: 'felt' },
      { name: 'amount', type: 'Uint256' },
    ],
    outputs: [{ name: 'success', type: 'felt' }],
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'felt' },
      { name: 'amount', type: 'Uint256' },
    ],
    outputs: [{ name: 'success', type: 'felt' }],
  },
];

// ── Cast Payment Contract ABI ──

export const CAST_PAYMENT_ABI = [
  {
    name: 'pay',
    type: 'function',
    inputs: [
      { name: 'endpoint_id', type: 'felt' },
      { name: 'creator', type: 'felt' },
      { name: 'amount', type: 'Uint256' },
      { name: 'nonce', type: 'felt' },
    ],
    outputs: [],
  },
  {
    name: 'batch_pay',
    type: 'function',
    inputs: [
      { name: 'endpoint_ids', type: 'felt*' },
      { name: 'creators', type: 'felt*' },
      { name: 'amounts', type: 'Uint256*' },
      { name: 'nonces', type: 'felt*' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    inputs: [
      { name: 'amount', type: 'Uint256' },
      { name: 'recipient', type: 'felt' },
    ],
    outputs: [],
  },
  {
    name: 'get_balance',
    type: 'function',
    inputs: [{ name: 'creator', type: 'felt' }],
    outputs: [{ name: 'balance', type: 'Uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'is_nonce_used',
    type: 'function',
    inputs: [{ name: 'nonce', type: 'felt' }],
    outputs: [{ name: 'used', type: 'felt' }],
    stateMutability: 'view',
  },
];

// ── Event Selectors ──
// Computed as: starknet_keccak("EventName") for Starknet events
// or sn_keccak("Transfer") for standard ERC-20

export const EVENT_SELECTORS = {
  // ERC-20 Transfer(from, to, value) — standard selector
  TRANSFER: '0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9',
  // ERC-20 Approval(owner, spender, value)
  APPROVAL: '0x134692b230b9e1ffa39098904722134159652b09c5bc41d88d6698779d228ff',
  // Cast PaymentReceived(endpoint_id, payer, creator, amount, nonce, timestamp)
  PAYMENT_RECEIVED: '0x02db340e6c609371026731f47050d3976552c89b4fbb012941b36db36571de3a',
};

// ── SNIP-12 Typed Data (Starknet's EIP-712 equivalent) ──
// Used for off-chain payment authorization: caller signs, Cast verifies + executes

/**
 * Build SNIP-12 typed data message for payment authorization
 * This is what the caller signs off-chain to authorize a USDC payment
 */
export function buildPaymentTypedData(chainId, paymentContract, params) {
  return {
    types: {
      StarkNetDomain: [
        { name: 'name', type: 'felt' },
        { name: 'version', type: 'felt' },
        { name: 'chainId', type: 'felt' },
      ],
      CastPayment: [
        { name: 'endpoint_id', type: 'felt' },
        { name: 'creator', type: 'felt' },
        { name: 'amount_low', type: 'felt' },
        { name: 'amount_high', type: 'felt' },
        { name: 'nonce', type: 'felt' },
        { name: 'deadline', type: 'felt' },
      ],
    },
    primaryType: 'CastPayment',
    domain: {
      name: 'CastPayment',
      version: '1',
      chainId,
    },
    message: {
      endpoint_id: params.endpointId,
      creator: params.creator,
      amount_low: params.amountLow,
      amount_high: params.amountHigh,
      nonce: params.nonce,
      deadline: params.deadline,
    },
  };
}

// ── USDC Constants ──

export const USDC_DECIMALS = 6;

/**
 * Convert human-readable USDC amount to on-chain uint256
 * e.g., 0.001 USDC → { low: '1000', high: '0' }
 */
export function usdcToUint256(amount) {
  const raw = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
  return {
    low: (raw & ((1n << 128n) - 1n)).toString(),
    high: (raw >> 128n).toString(),
  };
}

/**
 * Convert on-chain uint256 to human-readable USDC
 */
export function uint256ToUsdc(low, high) {
  const raw = BigInt(low) + (BigInt(high) << 128n);
  return Number(raw) / 10 ** USDC_DECIMALS;
}

/**
 * Normalize a Starknet address to full 66-char hex (0x + 64 chars)
 */
export function normalizeAddress(address) {
  if (!address) return null;
  const hex = address.replace(/^0x/, '');
  return '0x' + hex.padStart(64, '0');
}

/**
 * Check if two Starknet addresses are equal (ignoring zero-padding)
 */
export function addressEquals(a, b) {
  if (!a || !b) return false;
  return normalizeAddress(a) === normalizeAddress(b);
}
