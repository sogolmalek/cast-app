# SolAUDD adaptation

Summary of the work to adapt Cast — an instant API creation + x402 monetization layer originally built on Starknet + Base + X1 EcoChain — into a **Solana-native application settling in AUDD**, Australia's fully-backed digital dollar stablecoin, as an SPL token.

The existing chain-agnostic adapter design made this a clean swap. Cast's `PaymentVerifier` interface is unchanged; Solana plugs in as one more implementation.

## What changed

### Backend

- **Added `SolanaVerifier.js`** — verifies x402 payments by fetching the caller's confirmed Solana transaction via RPC and inspecting SPL token balance deltas (`preTokenBalances` vs `postTokenBalances`) for the configured AUDD mint. Works regardless of whether the caller used a plain `Transfer`, `TransferChecked`, or a CPI'd transfer. Also stubs an ed25519-signed authorization path for future pre-auth / channelised flows.
- **Removed `StarknetVerifier.js` + `starknet-constants.js`** — the entire Starknet adapter, including SNIP-12 typed data + AA/Paymaster paths.
- **`adapters/index.js`** — registers `solana`, `base`, `x1ecochain`.
- **`config.js`** — new `solana` block (`network`, `rpcUrl`, `commitment`, `auddMint`, `auddDecimals`, `recipientAddress`, `signerSecret`). `defaultChain: 'solana'`, `currency: 'AUDD'`.
- **`middleware/x402.js`** — on-chain nonce check is now chain-agnostic: any adapter that implements `isNonceUsed(nonce)` opts in, instead of the previous Starknet-only branch. The 402 response builds each `accepts` entry from the adapter's own `getPaymentMeta()` so currency/network come from the adapter, not a hardcoded mapping.
- **`routes/cast.js`** — dropped `GET /cast/chains/starknet/typed-data/:slug`. Added `GET /cast/chains/solana/payment-intent/:slug`, which returns the exact AUDD transfer intent (mint, recipient, amount in smallest units, UI amount) plus the X-Payment header template a caller should base64-encode.
- **`backend/package.json`** — removed `starknet`; added `@solana/web3.js`, `@solana/spl-token`, `tweetnacl`, `bs58`. Lockfile regenerated, zero residual Starknet packages.

### Frontend

- **`Balance.jsx`** — withdrawal defaults to Solana; dropdown now offers Solana (AUDD) / Base (USDC) / X1 EcoChain (USDT); address placeholder updated.
- **`Landing.jsx`** — copy now advertises AUDD settlement on Solana; chain row shows Solana + AUDD badge.
- **`Settings.jsx`** — supported-chains panel lists Solana (native) with AUDD features, plus Base and X1.
- **`Studio.jsx`** — mocked x402 preview now shows `chain: solana`, AUDD denomination, Solana-shaped base58 signatures, and `verifying on Solana… confirmed ✓` / `settled on Solana` status lines.

### Contracts

- **Removed `contracts/starknet/`** — Cairo payment contract and Scarb workspace.
- **Added `contracts/solana/`** — Anchor workspace with a `cast-payment` program:
  - Single instruction `pay_and_record(amount, nonce_hash, endpoint_id)` that CPIs an SPL transfer of AUDD from the payer to the recipient and initializes a `PaymentReceipt` PDA at `["receipt", payer, nonce_hash]`.
  - Second submission with the same `(payer, nonce_hash)` fails at account init — that is the on-chain replay guard and a canonical audit record, even if Cast's off-chain DB is lost.
  - `PaymentRecorded` event for indexers.
  - Mocha + chai integration tests covering the happy path, replay rejection, and zero-amount rejection.
- The program is **optional** for the x402 flow — `SolanaVerifier` accepts any confirmed AUDD transfer, so callers who don't want to touch the program can just send a plain SPL transfer and submit the tx signature. The program exists for callers who want atomic pay-and-record in one tx.

### Config / docs / ops

- **`backend/.env.example`** — Solana/AUDD block replaces the Starknet block; Base + X1 blocks unchanged.
- **`docker-compose.yml`** — Starknet env vars out, Solana + X1 env vars in.
- **`setup.sh`** — post-setup instructions point at the Solana env vars.
- **`README.md`** — full rewrite positioning Cast as a Solana/AUDD-native x402 layer, with dedicated "How AUDD Verification Works" section and Anchor build/deploy instructions.
- **`.gitignore`** — Solana/Anchor build artifacts replace Starknet targets.

## Verification

- Backend test suite: **28/28 passing.**
- `GET /cast/chains` returns `solana, base, x1ecochain`.
- `GET /cast/chains/solana/payment-intent/:slug` returns `{ currency: "AUDD", network: "devnet", auddMint, auddDecimals: 6, recipient, amount }`.
- Missing-payment requests now respond with a 402 whose `accepts` array lists all three chains with currency/network derived from the adapter.

## Why Solana + AUDD

Every claim in the SolAUDD prompt maps cleanly onto what Cast already does, only the settlement asset changes:

- **Payments** — every API call is a $0.001 AUDD payment, on-chain, with no API keys or accounts on the caller side.
- **Programmable finance** — the x402 protocol turns HTTP endpoints into metered, machine-payable services. Agents pay per call in AUDD.
- **Merchant / builder tools** — anyone can describe an API in one sentence, deploy it, and earn AUDD per call.
- **Production-ready UX** — sub-second finality and sub-cent fees on Solana are what make a $0.001 per-call price viable. AUDD over USDC gives Australian creators AUD-denominated revenue without a second FX leg.
