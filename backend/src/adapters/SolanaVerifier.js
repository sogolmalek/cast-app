import { PaymentVerifier } from './PaymentVerifier.js';
import { config } from '../config.js';

/**
 * SolanaVerifier — Payment verification for AUDD on Solana
 *
 * AUDD is Australia's fully-backed digital dollar stablecoin, deployed as an
 * SPL token on Solana. This verifier handles:
 *   1. SPL token transfer verification (AUDD mint match)
 *   2. Recipient + amount + payer validation
 *   3. Confirmed transaction lookup via RPC (getTransaction)
 *   4. Optional ed25519-signed authorization proofs (off-chain pre-auth flow)
 *
 * Grant context: Cast is applying for the SolAUDD grant. This verifier makes
 * Cast the first x402 micropayment API layer settling in AUDD on Solana.
 *
 * Network info:
 *   Mainnet: RPC https://api.mainnet-beta.solana.com
 *   Devnet:  RPC https://api.devnet.solana.com
 *   AUDD mint (mainnet): see config.solana.auddMint
 */
export class SolanaVerifier extends PaymentVerifier {
  constructor() {
    super('solana');
    this.rpcUrl = config.solana.rpcUrl;
    this.auddMint = config.solana.auddMint;
    this.auddDecimals = config.solana.auddDecimals; // AUDD uses 6 decimals (SPL convention)
    this.recipientAddress = config.solana.recipientAddress;
    this.network = config.solana.network;
    this.commitment = config.solana.commitment || 'confirmed';
  }

  getRecipientAddress() {
    return this.recipientAddress || '';
  }

  supportsPaymaster() {
    // Solana has fee-payer delegation (Cast can sponsor fees server-side),
    // but we don't expose it as AA-style paymaster in this initial release.
    return false;
  }

  getPaymentMeta() {
    return {
      chainId: this.chainId,
      chain: 'solana',
      currency: 'AUDD',
      network: this.network,
      rpcUrl: this.rpcUrl,
      auddMint: this.auddMint,
      auddDecimals: this.auddDecimals,
      supportsPaymaster: false,
      accountAbstraction: false,
      nativeToken: 'SOL',
      features: ['spl-token', 'sub-cent-fees', 'sub-second-finality'],
    };
  }

  /**
   * Verify a payment on Solana.
   *
   * Two proof formats supported:
   *   (a) On-chain settled: proof = base58 transaction signature
   *       → fetch tx, confirm it moved >= amount of AUDD from payer to recipient.
   *   (b) Signed authorization: proof = JSON { signature, message, ... }
   *       → ed25519 signature over a structured payment intent. (Reserved for
   *         future pre-auth / channelised flows; on-chain path is the default.)
   */
  async verify({ proof, payer, amount, nonce, recipient }) {
    try {
      // Case (a): signature string — looks like a base58 signature (typically 87–88 chars)
      if (typeof proof === 'string' && !proof.startsWith('{') && proof.length >= 64 && proof.length <= 128) {
        return await this._verifyOnChain({ signature: proof, payer, amount, recipient });
      }

      // Case (b): signed authorization JSON (ed25519)
      if (typeof proof === 'string' && proof.startsWith('{')) {
        const parsed = JSON.parse(proof);
        const ok = await this._verifySignedAuthorization(parsed, payer, amount, nonce);
        return { verified: ok, txHash: null };
      }

      return { verified: false, txHash: null };
    } catch (err) {
      console.error('[SolanaVerifier] verify error:', err.message);
      return { verified: false, txHash: null };
    }
  }

  /**
   * Settle: transfer accumulated creator balance from Cast's escrow wallet
   * to the creator's address on Solana. In production this is executed by the
   * server-side signer (config.solana.signerSecret). Left as a stub here — the
   * withdrawal route composes + signs + sends via @solana/web3.js.
   */
  async settle({ from, to, amount }) {
    try {
      console.log(`[SolanaVerifier] settle stub: ${amount} AUDD → ${to}`);
      // In production: build SPL transfer ix, sign with signer, send+confirm.
      return { txHash: null, status: 'pending' };
    } catch (err) {
      console.error('[SolanaVerifier] settle error:', err.message);
      return { txHash: null, status: 'failed' };
    }
  }

  // --- Private ---

  /**
   * Fetch the transaction from Solana RPC and validate it represents an AUDD
   * transfer of at least `amount` (smallest units) from `payer` to our recipient.
   *
   * We use token balance deltas (preTokenBalances / postTokenBalances) rather
   * than instruction parsing so it works regardless of whether the caller used
   * a plain Transfer, TransferChecked, or a CPI'd transfer via a program.
   */
  async _verifyOnChain({ signature, payer, amount, recipient }) {
    const tx = await this._rpc('getTransaction', [
      signature,
      { commitment: this.commitment, maxSupportedTransactionVersion: 0 },
    ]);

    if (!tx || !tx.meta) return { verified: false, txHash: null };
    if (tx.meta.err) return { verified: false, txHash: null };

    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];

    const expectedAmount = BigInt(amount);
    const targetRecipient = (recipient || this.recipientAddress || '').trim();
    if (!targetRecipient) return { verified: false, txHash: null };

    // Find the AUDD balance delta for recipient (must increase by >= expectedAmount)
    const recipientDelta = this._auddDelta(preBalances, postBalances, targetRecipient);
    if (recipientDelta < expectedAmount) {
      return { verified: false, txHash: null };
    }

    // Find the AUDD balance delta for payer (must decrease by >= expectedAmount)
    // Negative delta means funds left the payer's AUDD account.
    const payerDelta = this._auddDelta(preBalances, postBalances, payer);
    if (-payerDelta < expectedAmount) {
      return { verified: false, txHash: null };
    }

    return { verified: true, txHash: signature };
  }

  /**
   * Compute the net AUDD balance delta (post - pre, in smallest units) for a
   * given owner across all of that owner's AUDD token accounts in this tx.
   */
  _auddDelta(pre, post, owner) {
    const preAmt = this._sumAuddAmounts(pre, owner);
    const postAmt = this._sumAuddAmounts(post, owner);
    return postAmt - preAmt;
  }

  _sumAuddAmounts(tokenBalances, owner) {
    let total = 0n;
    for (const tb of tokenBalances) {
      if (!tb) continue;
      if (tb.mint !== this.auddMint) continue;
      if (tb.owner !== owner) continue;
      const raw = tb.uiTokenAmount?.amount;
      if (raw == null) continue;
      try { total += BigInt(raw); } catch { /* skip malformed */ }
    }
    return total;
  }

  async _verifySignedAuthorization(parsed, payer, amount, nonce) {
    // Placeholder for ed25519 verification. In production:
    //   import nacl from 'tweetnacl';
    //   nacl.sign.detached.verify(message, signature, new PublicKey(payer).toBytes());
    // The signed message binds: payer, recipient, mint, amount, nonce, expiry.
    console.warn('[SolanaVerifier] signed authorization path not yet wired to ed25519 verifier');
    return false;
  }

  async _rpc(method, params) {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`Solana RPC error: ${data.error.message || JSON.stringify(data.error)}`);
    return data.result;
  }
}
