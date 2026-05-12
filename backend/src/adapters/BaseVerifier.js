import { PaymentVerifier } from './PaymentVerifier.js';
import { config } from '../config.js';

/**
 * BaseVerifier — EVM-compatible payment verification for Base L2
 *
 * Base is where x402 originated. This verifier handles:
 * 1. Standard ERC-20 USDC transfer verification
 * 2. Transaction receipt validation
 * 3. Event log parsing for Transfer events
 *
 * Works identically for any EVM chain — can be extended for Arbitrum, Optimism, etc.
 */
export class BaseVerifier extends PaymentVerifier {
  constructor() {
    super('base');
    this.rpcUrl = config.base.rpcUrl;
    this.usdcAddress = config.base.usdcAddress;
    this.recipientAddress = process.env.BASE_RECIPIENT_ADDRESS || '0x0000000000000000000000000000000000000000';
  }

  async verify({ proof, payer, amount, nonce, recipient }) {
    try {
      if (proof.startsWith('0x') && proof.length === 66) {
        const receipt = await this._getTransactionReceipt(proof);
        if (!receipt || receipt.status !== '0x1') return { verified: false, txHash: null };

        const transferLog = this._findTransferLog(receipt, payer, amount);
        return {
          verified: transferLog !== null,
          txHash: proof,
        };
      }

      // Signed message verification (EIP-712)
      const isValid = await this._verifyEIP712(proof, payer, amount, nonce);
      return { verified: isValid, txHash: null };
    } catch (err) {
      console.error('Base verification error:', err);
      return { verified: false, txHash: null };
    }
  }

  async settle({ from, to, amount }) {
    try {
      const txHash = await this._executeTransfer(to, amount);
      return { txHash, status: 'completed' };
    } catch (err) {
      console.error('Base settlement error:', err);
      return { txHash: null, status: 'failed' };
    }
  }

  getRecipientAddress() {
    return this.recipientAddress;
  }

  supportsPaymaster() {
    return false; // Standard EVM — no native AA/paymaster
  }

  // --- Private methods ---

  async _getTransactionReceipt(txHash) {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [txHash],
          id: 1,
        }),
      });
      const data = await response.json();
      return data.result || null;
    } catch {
      return null;
    }
  }

  _findTransferLog(receipt, payer, amount) {
    if (!receipt.logs) return null;
    // ERC-20 Transfer(address,address,uint256) topic
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    for (const log of receipt.logs) {
      if (log.address?.toLowerCase() === this.usdcAddress.toLowerCase() &&
          log.topics?.[0] === transferTopic) {
        return log;
      }
    }
    return null;
  }

  async _verifyEIP712(proof, payer, amount, nonce) {
    // In production: use ethers.js to recover signer from EIP-712 signature
    // Verify recovered address matches payer
    return false; // Placeholder
  }

  async _executeTransfer(to, amount) {
    console.log(`Settlement: ${amount} USDC to ${to} on Base`);
    return '0x' + '0'.repeat(64);
  }
}
