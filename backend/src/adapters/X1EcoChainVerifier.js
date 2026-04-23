import { BaseVerifier } from './BaseVerifier.js';
import { config } from '../config.js';

/**
 * X1EcoChainVerifier — Payment verification for X1 EcoChain
 *
 * X1 EcoChain is EVM-compatible, so this extends BaseVerifier
 * and only overrides chain-specific config (RPC, addresses).
 *
 * Grant context: Cast is applying for the X1 EcoChain $5M Grant Program.
 * This verifier makes Cast the first x402 micropayment API layer on X1.
 *
 * Network info:
 *   Testnet:  Chain ID 10778, RPC https://maculatus-rpc.x1eco.com/
 *   Explorer: https://maculatus-scan.x1eco.com/
 */
export class X1EcoChainVerifier extends BaseVerifier {
  constructor() {
    // Call BaseVerifier with our chain ID
    super();
    this.chainId = 'x1ecochain';

    // Override with X1 EcoChain specific config
    this.rpcUrl = config.x1ecochain.rpcUrl;
    this.usdtAddress = config.x1ecochain.usdtAddress;
    this.recipientAddress = config.x1ecochain.recipientAddress;

    // X1 EcoChain uses USDT (integrated Q4 2025 per roadmap)
    this.paymentToken = 'USDT';
    this.paymentTokenDecimals = 6;
  }

  getRecipientAddress() {
    return this.recipientAddress || '';
  }

  supportsPaymaster() {
    return false; // standard EVM
  }

  getPaymentMeta() {
    return {
      chainId: this.chainId,
      chain: 'x1ecochain',
      currency: 'USDT',
      network: config.x1ecochain.network || 'testnet',
      rpcUrl: this.rpcUrl,
      explorer: config.x1ecochain.explorerUrl,
      supportsPaymaster: false,
      accountAbstraction: false,
      nativeToken: 'X1',
      features: ['DePIN', 'Web4', 'low-power-nodes', 'sub-cent-fees'],
    };
  }
}
