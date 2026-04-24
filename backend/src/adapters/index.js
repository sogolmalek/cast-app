import { SolanaVerifier } from './SolanaVerifier.js';
import { BaseVerifier } from './BaseVerifier.js';
import { X1EcoChainVerifier } from './X1EcoChainVerifier.js';

/**
 * Chain Adapter Registry
 *
 * Maintains a registry of PaymentVerifier implementations.
 * To add a new chain:
 * 1. Create YourChainVerifier extending PaymentVerifier (or BaseVerifier for EVM)
 * 2. Register it below
 * 3. Add chain to config.payment.supportedChains
 */
const verifiers = new Map();

// Register built-in verifiers
verifiers.set('solana', new SolanaVerifier());
verifiers.set('base', new BaseVerifier());
verifiers.set('x1ecochain', new X1EcoChainVerifier());

/**
 * Get the verifier for a specific chain
 * @param {string} chainId
 * @returns {PaymentVerifier}
 */
export function getVerifier(chainId) {
  const verifier = verifiers.get(chainId);
  if (!verifier) {
    throw new Error(`No payment verifier registered for chain: ${chainId}`);
  }
  return verifier;
}

/**
 * Register a new chain verifier (plugin model)
 * @param {string} chainId
 * @param {PaymentVerifier} verifier
 */
export function registerVerifier(chainId, verifier) {
  verifiers.set(chainId, verifier);
}

/**
 * List all registered chains with their capabilities
 */
export function listChains() {
  return Array.from(verifiers.entries()).map(([id, v]) => ({
    chainId: id,
    ...v.getPaymentMeta(),
  }));
}
