import { RpcProvider, Account, Contract, typedData, hash, num } from 'starknet';
import { PaymentVerifier } from './PaymentVerifier.js';
import { config } from '../config.js';
import {
  ERC20_ABI,
  CAST_PAYMENT_ABI,
  EVENT_SELECTORS,
  buildPaymentTypedData,
  usdcToUint256,
  uint256ToUsdc,
  normalizeAddress,
  addressEquals,
  USDC_DECIMALS,
} from './starknet-constants.js';

/**
 * StarknetVerifier — Production Starknet payment verification
 *
 * Two verification modes:
 *
 * MODE 1: Transaction Hash (post-execution)
 *   Caller already submitted a tx calling CastPayment.pay() or a direct USDC.transfer().
 *   Cast fetches the receipt, parses events, and verifies the payment landed.
 *
 * MODE 2: Signed Authorization (pre-execution, with Paymaster)
 *   Caller signs a SNIP-12 typed data message authorizing payment.
 *   Cast's server-side account executes the payment on behalf of the caller
 *   using Paymaster to sponsor gas. Caller pays zero gas.
 *
 * Settlement:
 *   When a creator withdraws, Cast's signer account calls CastPayment.withdraw()
 *   or directly transfers USDC to the creator's address.
 */
export class StarknetVerifier extends PaymentVerifier {
  constructor() {
    super('starknet');

    const starkConfig = config.starknet;
    this.rpcUrl = starkConfig.rpcUrl;
    this.chainId = starkConfig.chainId;
    this.paymentContractAddress = starkConfig.paymentContractAddress;
    this.usdcAddress = starkConfig.usdcAddress;
    this.paymasterEnabled = starkConfig.paymasterEnabled;
    this.maxGasSubsidyUsd = starkConfig.maxGasSubsidyUsd;
    this.pollInterval = starkConfig.receiptPollIntervalMs;
    this.pollMaxAttempts = starkConfig.receiptPollMaxAttempts;
    this.acceptPending = starkConfig.acceptPendingTx;

    // Initialize RPC provider
    this.provider = new RpcProvider({ nodeUrl: this.rpcUrl });

    // Initialize server-side signer account (for settlements + paymaster execution)
    if (starkConfig.signerAddress && starkConfig.signerPrivateKey) {
      this.signerAccount = new Account(
        this.provider,
        starkConfig.signerAddress,
        starkConfig.signerPrivateKey,
      );
    } else {
      this.signerAccount = null;
      console.warn('[StarknetVerifier] No signer account configured — settlements will fail');
    }

    // Lazy contract instances
    this._usdcContract = null;
    this._paymentContract = null;
  }

  // ── Contract Accessors (lazy init) ──

  get usdcContract() {
    if (!this._usdcContract) {
      this._usdcContract = new Contract(ERC20_ABI, this.usdcAddress, this.provider);
      if (this.signerAccount) this._usdcContract.connect(this.signerAccount);
    }
    return this._usdcContract;
  }

  get paymentContract() {
    if (!this._paymentContract && this.paymentContractAddress) {
      this._paymentContract = new Contract(
        CAST_PAYMENT_ABI,
        this.paymentContractAddress,
        this.provider,
      );
      if (this.signerAccount) this._paymentContract.connect(this.signerAccount);
    }
    return this._paymentContract;
  }

  // ══════════════════════════════════════════════
  // VERIFY — Core verification entry point
  // ══════════════════════════════════════════════

  async verify({ proof, payer, amount, nonce, recipient }) {
    try {
      const proofType = this._classifyProof(proof);

      switch (proofType) {
        case 'tx_hash':
          return await this._verifyTransactionHash(proof, payer, amount, nonce, recipient);
        case 'signed_authorization':
          return await this._verifySignedAuthorization(proof, payer, amount, nonce, recipient);
        default:
          console.error(`[StarknetVerifier] Unknown proof type for: ${proof.slice(0, 20)}...`);
          return { verified: false, txHash: null };
      }
    } catch (err) {
      console.error('[StarknetVerifier] Verification error:', err);
      return { verified: false, txHash: null };
    }
  }

  // ══════════════════════════════════════════════
  // MODE 1: Transaction Hash Verification
  // ══════════════════════════════════════════════

  async _verifyTransactionHash(txHash, payer, amount, nonce, recipient) {
    // Step 1: Get receipt (poll if pending)
    const receipt = await this._waitForReceipt(txHash);
    if (!receipt) {
      console.error(`[StarknetVerifier] No receipt for tx ${txHash}`);
      return { verified: false, txHash };
    }

    // Step 2: Check execution succeeded
    if (!this._isSuccessfulExecution(receipt)) {
      console.error(`[StarknetVerifier] Tx ${txHash} failed: ${receipt.execution_status}`);
      return { verified: false, txHash };
    }

    // Step 3: Parse events and verify payment
    const paymentVerified = this._verifyPaymentEvents(receipt, payer, amount, nonce, recipient);
    if (!paymentVerified) {
      console.error(`[StarknetVerifier] Payment events not found in tx ${txHash}`);
      return { verified: false, txHash };
    }

    return { verified: true, txHash };
  }

  /**
   * Poll for transaction receipt until finalized or timeout
   */
  async _waitForReceipt(txHash) {
    for (let attempt = 0; attempt < this.pollMaxAttempts; attempt++) {
      try {
        const receipt = await this.provider.getTransactionReceipt(txHash);

        // Final states
        if (receipt.finality_status === 'ACCEPTED_ON_L2' ||
            receipt.finality_status === 'ACCEPTED_ON_L1') {
          return receipt;
        }

        // Accept pending if configured
        if (this.acceptPending && receipt.finality_status === 'RECEIVED') {
          return receipt;
        }

        // Still pending — wait
        if (attempt < this.pollMaxAttempts - 1) {
          await this._sleep(this.pollInterval);
        }
      } catch (err) {
        // Tx not yet known — wait and retry
        if (err.message?.includes('TXN_HASH_NOT_FOUND') ||
            err.message?.includes('not found') ||
            err.message?.includes('25')) {
          if (attempt < this.pollMaxAttempts - 1) {
            await this._sleep(this.pollInterval);
            continue;
          }
        }
        throw err;
      }
    }
    return null;
  }

  /**
   * Check if transaction executed successfully
   */
  _isSuccessfulExecution(receipt) {
    if (receipt.execution_status) {
      return receipt.execution_status === 'SUCCEEDED';
    }
    if (receipt.status) {
      return receipt.status === 'ACCEPTED_ON_L2' || receipt.status === 'ACCEPTED_ON_L1';
    }
    return receipt.events && receipt.events.length > 0;
  }

  /**
   * Verify payment events in receipt.
   * Pattern A: CastPayment.PaymentReceived event
   * Pattern B: USDC Transfer event (direct transfer fallback)
   */
  _verifyPaymentEvents(receipt, payer, expectedAmount, nonce, recipient) {
    if (!receipt.events || receipt.events.length === 0) return false;

    const expectedRaw = BigInt(Math.round(parseFloat(expectedAmount) * 10 ** USDC_DECIMALS));
    const normalizedPayer = normalizeAddress(payer);
    const normalizedRecipient = normalizeAddress(recipient || this.paymentContractAddress);

    // Pattern A: CastPayment PaymentReceived event
    for (const event of receipt.events) {
      const src = normalizeAddress(event.from_address);
      if (addressEquals(src, this.paymentContractAddress) &&
          event.keys?.[0] === EVENT_SELECTORS.PAYMENT_RECEIVED) {
        // keys: [selector, endpoint_id, payer]
        // data: [creator, amount_low, amount_high, nonce, timestamp]
        const eventPayer = normalizeAddress(event.keys[2]);
        if (!addressEquals(eventPayer, normalizedPayer)) continue;

        const eventAmount = BigInt(event.data[1] || '0') + (BigInt(event.data[2] || '0') << 128n);
        const eventNonce = event.data[3];

        if (this._amountMatches(eventAmount, expectedRaw) &&
            this._nonceMatches(eventNonce, nonce)) {
          return true;
        }
      }
    }

    // Pattern B: ERC-20 Transfer event
    for (const event of receipt.events) {
      const src = normalizeAddress(event.from_address);
      if (addressEquals(src, this.usdcAddress) &&
          event.keys?.[0] === EVENT_SELECTORS.TRANSFER) {
        // keys: [selector, from, to]
        // data: [amount_low, amount_high]
        const from = normalizeAddress(event.keys[1]);
        const to = normalizeAddress(event.keys[2]);

        if (!addressEquals(from, normalizedPayer)) continue;
        if (!addressEquals(to, normalizedRecipient)) continue;

        const eventAmount = BigInt(event.data[0] || '0') + (BigInt(event.data[1] || '0') << 128n);
        if (this._amountMatches(eventAmount, expectedRaw)) {
          return true;
        }
      }
    }

    return false;
  }

  // ══════════════════════════════════════════════
  // MODE 2: Signed Authorization (SNIP-12)
  // ══════════════════════════════════════════════

  async _verifySignedAuthorization(proofStr, payer, amount, nonce, recipient) {
    let signedAuth;
    try {
      signedAuth = JSON.parse(proofStr);
    } catch {
      console.error('[StarknetVerifier] Invalid signed authorization JSON');
      return { verified: false, txHash: null };
    }

    const { signature, endpointId, creator, deadline } = signedAuth;
    if (!signature || !endpointId) {
      return { verified: false, txHash: null };
    }

    // Check deadline
    if (deadline) {
      const now = Math.floor(Date.now() / 1000);
      if (now > parseInt(deadline)) {
        console.error('[StarknetVerifier] Authorization expired');
        return { verified: false, txHash: null };
      }
    }

    // Reconstruct typed data
    const amountUint256 = usdcToUint256(parseFloat(amount));
    const typedDataMsg = buildPaymentTypedData(this.chainId, this.paymentContractAddress, {
      endpointId,
      creator: creator || recipient,
      amountLow: amountUint256.low,
      amountHigh: amountUint256.high,
      nonce,
      deadline: deadline || '0',
    });

    // Verify signature via account's isValidSignature (SRC-6)
    const sigValid = await this._verifyAccountSignature(payer, typedDataMsg, signature);
    if (!sigValid) {
      console.error('[StarknetVerifier] Signature verification failed');
      return { verified: false, txHash: null };
    }

    // Execute payment on behalf of caller
    if (!this.signerAccount) {
      console.error('[StarknetVerifier] No signer — cannot execute authorized payment');
      return { verified: false, txHash: null };
    }

    const txHash = await this._executeAuthorizedPayment(
      payer, endpointId, creator || recipient, amount, nonce
    );

    return { verified: !!txHash, txHash };
  }

  /**
   * Verify SNIP-12 signature via the account's isValidSignature (SRC-6).
   * Supports ANY account type (ArgentX, Braavos, custom) — that's native AA.
   */
  async _verifyAccountSignature(accountAddress, typedDataMsg, signature) {
    try {
      const msgHash = typedData.getMessageHash(typedDataMsg, accountAddress);

      const result = await this.provider.callContract({
        contractAddress: accountAddress,
        entrypoint: 'is_valid_signature',
        calldata: [
          msgHash,
          signature.length.toString(),
          ...signature,
        ],
      });

      // SRC-6 returns 'VALID' as felt = 0x56414C4944
      return BigInt(result[0]) === BigInt('0x56414C4944');
    } catch (err) {
      console.error('[StarknetVerifier] isValidSignature failed:', err.message);
      return false;
    }
  }

  /**
   * Execute payment on-chain using Cast's signer account.
   * If paymaster is enabled, gas is sponsored.
   */
  async _executeAuthorizedPayment(payer, endpointId, creator, amount, nonce) {
    try {
      const amountUint256 = usdcToUint256(parseFloat(amount));

      let txResult;

      if (this.paymentContractAddress) {
        // Use CastPayment.pay() — requires payer to have approved the contract
        txResult = await this.signerAccount.execute([
          {
            contractAddress: this.paymentContractAddress,
            entrypoint: 'pay',
            calldata: [endpointId, creator, amountUint256.low, amountUint256.high, nonce],
          },
        ]);
      } else {
        // Direct USDC transferFrom
        txResult = await this.signerAccount.execute([
          {
            contractAddress: this.usdcAddress,
            entrypoint: 'transferFrom',
            calldata: [payer, this.signerAccount.address, amountUint256.low, amountUint256.high],
          },
        ]);
      }

      console.log(`[StarknetVerifier] Payment tx: ${txResult.transaction_hash}`);

      const receipt = await this._waitForReceipt(txResult.transaction_hash);
      if (receipt && this._isSuccessfulExecution(receipt)) {
        return txResult.transaction_hash;
      }
      return null;
    } catch (err) {
      console.error('[StarknetVerifier] Execute authorized payment failed:', err);
      return null;
    }
  }

  // ══════════════════════════════════════════════
  // SETTLE — Creator withdrawal
  // ══════════════════════════════════════════════

  async settle({ from, to, amount }) {
    if (!this.signerAccount) {
      console.error('[StarknetVerifier] No signer account for settlement');
      return { txHash: null, status: 'failed' };
    }

    try {
      const amountUint256 = usdcToUint256(parseFloat(amount));
      let txResult;

      if (this.paymentContractAddress) {
        txResult = await this.signerAccount.execute([
          {
            contractAddress: this.paymentContractAddress,
            entrypoint: 'withdraw',
            calldata: [amountUint256.low, amountUint256.high, to],
          },
        ]);
      } else {
        txResult = await this.signerAccount.execute([
          {
            contractAddress: this.usdcAddress,
            entrypoint: 'transfer',
            calldata: [to, amountUint256.low, amountUint256.high],
          },
        ]);
      }

      console.log(`[StarknetVerifier] Settlement tx: ${txResult.transaction_hash}`);

      const receipt = await this._waitForReceipt(txResult.transaction_hash);
      if (receipt && this._isSuccessfulExecution(receipt)) {
        return { txHash: txResult.transaction_hash, status: 'completed' };
      }

      return { txHash: txResult.transaction_hash, status: 'failed' };
    } catch (err) {
      console.error('[StarknetVerifier] Settlement error:', err);
      return { txHash: null, status: 'failed' };
    }
  }

  // ══════════════════════════════════════════════
  // PUBLIC METHODS
  // ══════════════════════════════════════════════

  getRecipientAddress() {
    return this.paymentContractAddress || this.signerAccount?.address || '';
  }

  supportsPaymaster() {
    return this.paymasterEnabled && !!this.signerAccount;
  }

  getPaymentMeta() {
    return {
      ...super.getPaymentMeta(),
      network: this.chainId,  // SN_MAIN, SN_SEPOLIA etc — use 'network' not 'chainId'
      supportsPaymaster: this.supportsPaymaster(),
      accountAbstraction: true,
      feeTokens: ['STRK', 'ETH'],
      paymentContract: this.paymentContractAddress || null,
      usdcAddress: this.usdcAddress,
      paymasterInfo: this.supportsPaymaster() ? {
        description: 'Cast sponsors gas — you only pay the API call fee',
        maxGasSubsidy: `$${this.maxGasSubsidyUsd}`,
      } : null,
      verificationModes: ['tx_hash', 'signed_authorization'],
    };
  }

  /**
   * Check on-chain nonce usage
   */
  async isNonceUsed(nonce) {
    if (!this.paymentContractAddress) return false;
    try {
      const result = await this.provider.callContract({
        contractAddress: this.paymentContractAddress,
        entrypoint: 'is_nonce_used',
        calldata: [nonce],
      });
      return BigInt(result[0]) !== 0n;
    } catch {
      return false;
    }
  }

  /**
   * Get on-chain creator balance
   */
  async getCreatorBalance(creatorAddress) {
    if (!this.paymentContractAddress) return 0;
    try {
      const result = await this.provider.callContract({
        contractAddress: this.paymentContractAddress,
        entrypoint: 'get_balance',
        calldata: [creatorAddress],
      });
      return uint256ToUsdc(result[0], result[1]);
    } catch {
      return 0;
    }
  }

  // ══════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════

  _classifyProof(proof) {
    if (!proof) return 'unknown';
    if (/^0x[0-9a-fA-F]{63,64}$/.test(proof)) return 'tx_hash';
    if (proof.startsWith('{')) return 'signed_authorization';
    try {
      const decoded = Buffer.from(proof, 'base64').toString();
      if (decoded.startsWith('{')) return 'signed_authorization';
    } catch { /* not base64 */ }
    return 'unknown';
  }

  _amountMatches(actual, expected) {
    const diff = actual > expected ? actual - expected : expected - actual;
    return diff <= 1n;
  }

  _nonceMatches(eventNonce, expectedNonce) {
    if (!eventNonce || !expectedNonce) return true;
    const a = eventNonce.toLowerCase().replace(/^0x/, '').replace(/^0+/, '');
    const b = expectedNonce.toLowerCase().replace(/^0x/, '').replace(/^0+/, '');
    return a === b;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
