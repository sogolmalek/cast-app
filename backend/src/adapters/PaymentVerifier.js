/**
 * PaymentVerifier — Abstract interface for chain-specific payment verification.
 *
 * Any chain that wants to support Cast payments implements this interface.
 * The x402 middleware calls verify() and settle() through this interface,
 * making the payment gateway fully chain-agnostic.
 *
 * To add a new chain:
 * 1. Create a new file in adapters/ extending PaymentVerifier
 * 2. Implement verify(), settle(), getRecipientAddress()
 * 3. Register in adapters/index.js
 */
export class PaymentVerifier {
  constructor(chainId) {
    if (new.target === PaymentVerifier) {
      throw new Error('PaymentVerifier is abstract — extend it per chain');
    }
    this.chainId = chainId;
  }

  /**
   * Verify a payment proof on-chain
   * @param {Object} params
   * @param {string} params.proof - Chain-specific payment proof (signed tx, receipt, etc.)
   * @param {string} params.payer - Payer's address
   * @param {string} params.amount - Amount in smallest unit (e.g., USDC 6 decimals)
   * @param {string} params.nonce - Unique nonce to prevent replay
   * @param {string} params.recipient - Expected recipient address
   * @returns {Promise<{ verified: boolean, txHash: string|null }>}
   */
  async verify(params) {
    throw new Error('verify() must be implemented by chain adapter');
  }

  /**
   * Settle a payment (initiate transfer from escrow to creator)
   * @param {Object} params
   * @param {string} params.from - Source address (escrow)
   * @param {string} params.to - Destination address (creator)
   * @param {string} params.amount - Amount in smallest unit
   * @returns {Promise<{ txHash: string, status: string }>}
   */
  async settle(params) {
    throw new Error('settle() must be implemented by chain adapter');
  }

  /**
   * Get the recipient address for this chain (Cast's escrow/payment contract)
   * @returns {string}
   */
  getRecipientAddress() {
    throw new Error('getRecipientAddress() must be implemented by chain adapter');
  }

  /**
   * Check if this chain supports paymaster (gas sponsorship)
   * @returns {boolean}
   */
  supportsPaymaster() {
    return false;
  }

  /**
   * Get chain-specific metadata for 402 response
   * @returns {Object}
   */
  getPaymentMeta() {
    return {
      chain: this.chainId,
      currency: 'USDC',
      supportsPaymaster: this.supportsPaymaster(),
    };
  }
}
