 # Cast
 
-**Instant API creation and monetization for the AI agent economy, settled in AUDD on Solana.**
+**Instant API creation and monetization for the AI agent economy.**
 
 Describe any API in one sentence. Cast generates a production-ready endpoint and deploys it at a unique URL in under 5 seconds. Every call settles a **$0.001 micropayment via the x402 protocol** — on-chain, with no API keys, no accounts, and no billing dashboards for callers.
 
-Cast's native settlement asset is **AUDD**, Australia's fully-backed digital dollar stablecoin, as an SPL token on Solana. Base (USDC) and X1 EcoChain (USDT) are also supported via chain adapters.
+Cast is chain-agnostic by design. The payment layer is built around a `PaymentVerifier` interface — any chain plugs in as an adapter. Currently supported: **Solana (AUDD)**, **Base (USDC)**, and **X1 EcoChain (USDT)**.
 
 ---
 
@@ -36,6 +36,7 @@ npm run dev
 
 ```
 cd backend && node run-tests.js
+# 28/28 passing
 ```
 
 ---
@@ -48,16 +49,19 @@ cd backend && node run-tests.js
 2. Describe your API in the Studio: *"An API that converts any currency to any other currency"*
 3. Iterate — tell Cast to change the schema, add validation, modify logic
 4. Deploy — one click, live URL, under 5 seconds
-5. Earn — every call credits your balance with $0.001 AUDD, settled on-chain
+5. Earn — every call credits your balance on-chain, in whichever currency your chain uses
 
 ### For callers (agents / developers)
 
 ```
-# Check what the endpoint expects
+# Check what the endpoint expects and which chains are accepted
 curl https://cast.dev/cast/my-endpoint-slug
 
-# Call with x402 payment (Solana / AUDD)
-PAYMENT=$(echo '{"chain":"solana","proof":"<base58 tx signature>","payer":"<your Solana address>","amount":"1000","nonce":"abc123"}' | base64)
+# Call with x402 payment — Solana example (AUDD)
+PAYMENT=$(echo '{"chain":"solana","proof":"<base58 tx signature>","payer":"<solana address>","amount":"1000","nonce":"abc123"}' | base64)
+
+# Call with x402 payment — Base example (USDC)
+PAYMENT=$(echo '{"chain":"base","proof":"0x_tx_hash","payer":"0x_address","amount":"1000","nonce":"abc123"}' | base64)
 
 curl -X POST https://cast.dev/cast/my-endpoint-slug \
   -H "Content-Type: application/json" \
@@ -65,7 +69,7 @@ curl -X POST https://cast.dev/cast/my-endpoint-slug \
   -d '{"your": "input"}'
 ```
 
-No API keys. No accounts. Just HTTP + an on-chain AUDD transfer.
+No API keys. No accounts. Just HTTP + an on-chain payment.
 
 ---
 
@@ -87,43 +91,17 @@ No API keys. No accounts. Just HTTP + an on-chain AUDD transfer.
 └──────────────────────────────────────────────────────────┘
 ```
 
-The payment layer is fully chain-agnostic. Any chain that implements the `PaymentVerifier` interface plugs in automatically.
-
 ---
 
 ## Supported Chains
 
 | Chain | Type | Token | Status |
 | --- | --- | --- | --- |
-| **Solana** | L1 | **AUDD** (SPL) | ✅ Native — sub-cent fees, sub-second finality |
+| **Solana** | L1 | **AUDD** (SPL) | ✅ Sub-cent fees, sub-second finality |
 | **Base** | EVM L2 | USDC | ✅ x402 origin chain |
 | **X1 EcoChain** | EVM L1 | USDT | ✅ DePIN / Web4 |
 | Any EVM chain | EVM | any ERC-20 | Extend `BaseVerifier` |
 
-### Adding a new chain (EVM)
-
-```
-import { BaseVerifier } from './BaseVerifier.js';
-
-export class MyChainVerifier extends BaseVerifier {
-  constructor() {
-    super();
-    this.chainId = 'mychain';
-    this.rpcUrl = 'https://rpc.mychain.io';
-    this.recipientAddress = '0x_your_address';
-  }
-  getRecipientAddress() { return this.recipientAddress; }
-}
-```
-
-Register in `adapters/index.js`:
-
-```
-verifiers.set('mychain', new MyChainVerifier());
-```
-
-Add to `config.payment.supportedChains`. Done.
-
 ---
 
 ## x402 Payment Flow
@@ -131,16 +109,14 @@ Add to `config.payment.supportedChains`. Done.
 ```
 POST /cast/:slug
   │
-  ├─ No X-Payment header → 402 { accepts: [{ chain, amount, recipient }] }
+  ├─ No X-Payment header → 402 { accepts: [{ chain, currency, amount, recipient }] }
   │
   ├─ Parse X-Payment (base64 JSON)
   │   { chain, proof, payer, amount, nonce }
   │
-  ├─ Dual nonce check (local DB + optional on-chain hook)
+  ├─ Dual nonce check (local DB + optional on-chain hook per adapter)
   │
   ├─ Route to chain adapter → verify()
-  │     Solana: fetch tx, confirm AUDD balance delta matches
-  │     Base/X1: fetch receipt, parse Transfer event
   │
   ├─ Credit creator balance
   │
@@ -149,18 +125,104 @@ POST /cast/:slug
 
 ---
 
-## How AUDD Verification Works
+## Solana — AUDD
+
+AUDD is Australia's fully-backed digital dollar stablecoin, deployed as an SPL token on Solana. Solana is Cast's primary chain for the following reasons: sub-cent transaction fees make $0.001 per-call settlements viable, finality is sub-second, and AUDD gives Australian creators AUD-denominated revenue without a second FX leg.
+
+### How AUDD verification works
 
-Cast's `SolanaVerifier` takes a base58 transaction signature as the payment proof, fetches the confirmed tx via RPC, and validates the payment using **SPL token balance deltas** (`preTokenBalances` vs `postTokenBalances`). This approach works whether the caller used a plain SPL `Transfer`, `TransferChecked`, or a CPI'd transfer via another program (including Cast's own `cast-payment` Anchor program).
+`SolanaVerifier` takes a base58 transaction signature as the payment proof, fetches the confirmed transaction via RPC, and validates the payment using SPL token balance deltas (`preTokenBalances` vs `postTokenBalances`). This works regardless of whether the caller used a plain `Transfer`, `TransferChecked`, or a CPI'd transfer via Cast's own `cast-payment` Anchor program.
 
-Concretely, for a payment to verify:
+For a payment to verify:
+- transaction must be confirmed with no error
+- recipient's AUDD balance must increase by at least the requested amount
+- payer's AUDD balance must decrease by at least the requested amount
+- mint on the token balance entries must equal the configured `SOLANA_AUDD_MINT`
 
-- the transaction must be confirmed and have no error
-- the recipient's AUDD balance must increase by at least the requested amount
-- the payer's AUDD balance must decrease by at least the requested amount
-- the mint on the token balance entries must equal the configured `SOLANA_AUDD_MINT`
+Replay protection: local DB nonce check first, then an optional on-chain lookup via `isNonceUsed(nonce)` that any adapter can implement.
 
-Replay protection is layered: local DB nonce check first, then an optional on-chain nonce lookup that any adapter can implement (`isNonceUsed(nonce)`).
+### Solana payment intent helper
+
+```
+GET /cast/chains/solana/payment-intent/:slug
+```
+
+Returns the full AUDD transfer intent — mint address, recipient, amount in smallest units, UI amount, network — plus an X-Payment header template ready to base64-encode. Useful for agents building the payment step automatically.
+
+### Cast Anchor program (optional)
+
+`contracts/solana/programs/cast-payment` provides `pay_and_record(amount, nonce_hash, endpoint_id)`: a single instruction that CPIs an SPL transfer of AUDD and writes a `PaymentReceipt` PDA at `["receipt", payer, nonce_hash]`. The PDA serves as a canonical on-chain replay guard. Callers who do not use the program can send a plain SPL transfer — the verifier handles both.
+
+```
+cd contracts/solana
+anchor build
+anchor deploy --provider.cluster devnet
+```
+
+### Solana environment variables
+
+```
+SOLANA_NETWORK=devnet
+SOLANA_RPC_URL=https://api.devnet.solana.com
+SOLANA_COMMITMENT=confirmed
+SOLANA_AUDD_MINT=<AUDD SPL mint for your network>
+SOLANA_AUDD_DECIMALS=6
+SOLANA_RECIPIENT_ADDRESS=<Cast recipient wallet>
+SOLANA_SIGNER_SECRET=<base58 secret, server-side only>
+```
+
+---
+
+## X1 EcoChain — USDT
+
+X1 EcoChain is an EVM-compatible L1 designed for DePIN and Web4 workloads. Cast integrates X1 via `X1EcoChainVerifier`, which extends the EVM `BaseVerifier` and overrides the chain-specific config (RPC URL, chain ID, USDT contract address).
+
+X1 is a natural fit for Cast's per-call payment model: low-power nodes and sub-cent fees make micropayment settlement practical, and the USDT integration (planned Q4 2025 per X1 roadmap) gives callers a stable settlement asset.
+
+### How X1 verification works
+
+`X1EcoChainVerifier` fetches the transaction receipt and looks for an ERC-20 `Transfer(address,address,uint256)` event on the configured USDT contract, confirming the sender, recipient, and amount match the payment claim. The logic is identical to Base — only the RPC URL, chain ID, and token contract differ.
+
+### X1 environment variables
+
+```
+X1_NETWORK=testnet
+X1_RPC_URL=https://maculatus-rpc.x1eco.com/
+X1_CHAIN_ID=10778
+X1_USDT_ADDRESS=<USDT contract on X1>
+X1_RECIPIENT_ADDRESS=<Cast recipient address on X1>
+X1_EXPLORER_URL=https://maculatus-scan.x1eco.com/
+```
+
+---
+
+## Base — USDC
+
+Base is where the x402 protocol originated. Cast's `BaseVerifier` handles standard ERC-20 USDC transfer verification via transaction receipt + Transfer event log parsing. It also serves as the base class for any additional EVM chain.
+
+```
+BASE_RPC_URL=https://mainnet.base.org
+BASE_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
+BASE_RECIPIENT_ADDRESS=0x_your_address
+```
+
+### Adding a new EVM chain
+
+```js
+import { BaseVerifier } from './BaseVerifier.js';
+
+export class MyChainVerifier extends BaseVerifier {
+  constructor() {
+    super();
+    this.chainId = 'mychain';
+    this.rpcUrl = 'https://rpc.mychain.io';
+    this.recipientAddress = '0x_your_address';
+  }
+  getRecipientAddress() { return this.recipientAddress; }
+}
+```
+
+Register in `adapters/index.js` and add to `config.payment.supportedChains`. Done.
 
 ---
 
@@ -171,9 +233,9 @@ cast/
 ├── backend/src/
 │   ├── adapters/
 │   │   ├── PaymentVerifier.js      Abstract interface
-│   │   ├── SolanaVerifier.js       Solana: SPL token balance delta verification for AUDD
-│   │   ├── BaseVerifier.js         EVM: Transfer event verification
-│   │   ├── X1EcoChainVerifier.js   X1 EcoChain (extends BaseVerifier)
+│   │   ├── SolanaVerifier.js       AUDD SPL token balance delta verification
+│   │   ├── BaseVerifier.js         EVM: Transfer event verification (Base + any EVM)
+│   │   ├── X1EcoChainVerifier.js   X1 EcoChain USDT (extends BaseVerifier)
 │   │   └── index.js                Registry + plugin system
 │   ├── middleware/
 │   │   ├── auth.js                 JWT
@@ -182,7 +244,7 @@ cast/
 │   │   ├── auth.js                 Signup, login, BYOK key
 │   │   ├── endpoints.js            Generate, iterate, deploy, test
 │   │   ├── balance.js              Earnings + withdrawals
-│   │   └── cast.js                 Public endpoint serving + Solana payment-intent helper
+│   │   └── cast.js                 Public endpoint serving + chain helpers
 │   └── services/
 │       ├── generator.js            Claude API → endpoint code
 │       └── runtime.js              Sandboxed VM execution
@@ -190,10 +252,10 @@ cast/
 │   ├── Studio.jsx                  NL editor — core product
 │   ├── Dashboard.jsx               Endpoint management
 │   ├── EndpointDetail.jsx          Analytics + test + docs
-│   ├── Balance.jsx                 Earnings + withdrawals
+│   ├── Balance.jsx                 Earnings + withdrawals (Solana / Base / X1)
 │   └── Settings.jsx                BYOK key + chain config
 ├── contracts/solana/
-│   └── programs/cast-payment/      Anchor program: atomic pay + nonce registry
+│   └── programs/cast-payment/      Anchor program: atomic pay + nonce registry PDA
 ├── .github/workflows/
 │   ├── ci.yml                      Test + build on push
 │   └── deploy.yml                  Production deploy
@@ -205,43 +267,11 @@ cast/
 
 ---
 
-## Environment Variables
-
-```
-# Server
-PORT=3001
-JWT_SECRET=<random 32+ chars>
-
-# Solana / AUDD (native chain)
-SOLANA_NETWORK=devnet
-SOLANA_RPC_URL=https://api.devnet.solana.com
-SOLANA_COMMITMENT=confirmed
-SOLANA_AUDD_MINT=<AUDD SPL mint for the chosen network>
-SOLANA_AUDD_DECIMALS=6
-SOLANA_RECIPIENT_ADDRESS=<Cast recipient wallet>
-SOLANA_SIGNER_SECRET=<base58 secret, server-side only>
-
-# Base
-BASE_RPC_URL=https://mainnet.base.org
-BASE_RECIPIENT_ADDRESS=0x_your_address
-
-# X1 EcoChain
-X1_NETWORK=testnet
-X1_RPC_URL=https://maculatus-rpc.x1eco.com/
-X1_CHAIN_ID=10778
-X1_USDT_ADDRESS=0x_usdt_on_x1
-X1_RECIPIENT_ADDRESS=0x_your_address
-```
-
-See `backend/.env.example` for all options.
-
----
-
 ## Deploy to Production
 
 ```
 # Docker
-cp backend/.env.example backend/.env  # configure
+cp backend/.env.example backend/.env  # configure all chain vars
 docker compose up -d
 curl http://localhost:3001/health
 
@@ -253,38 +283,18 @@ NODE_ENV=production node backend/src/index.js
 
 ---
 
-## Solana Program (optional)
-
-Cast ships an Anchor program, `cast-payment`, under `contracts/solana/`. The off-chain verifier does **not** require it — it verifies any confirmed AUDD transfer by balance delta. The program is provided for callers who want atomic pay-and-record in a single transaction, with a per-(payer, nonce) PDA receipt that serves as a canonical on-chain replay guard.
-
-Build and deploy:
-
-```
-cd contracts/solana
-anchor build
-anchor deploy --provider.cluster devnet
-```
-
-The program exposes a single instruction, `pay_and_record(amount, nonce_hash, endpoint_id)`, which CPIs an SPL `transfer` of AUDD from the payer to the recipient and initializes a `PaymentReceipt` PDA at `["receipt", payer, nonce_hash]`. Re-submitting the same nonce fails at account init — that is the replay guard.
-
----
-
 ## API Reference
 
 ### Auth
-
 `POST /api/auth/signup` · `POST /api/auth/login` · `GET /api/auth/me` · `PUT /api/auth/claude-key`
 
 ### Endpoints
-
 `GET /api/endpoints` · `POST /api/endpoints/generate` · `POST /api/endpoints/iterate` · `POST /api/endpoints/deploy` · `POST /api/endpoints/:id/test` · `GET /api/endpoints/:id/analytics`
 
 ### Balance
-
 `GET /api/balance` · `POST /api/balance/withdraw` · `GET /api/balance/withdrawals`
 
 ### Public (x402)
-
 `GET /cast` · `GET /cast/chains` · `GET /cast/chains/solana/payment-intent/:slug` · `GET /cast/:slug` · `POST /cast/:slug`
 
 ---
@@ -295,7 +305,7 @@ The program exposes a single instruction, `pay_and_record(amount, nonce_hash, en
 
 **Frontend:** React 18, Vite, Tailwind CSS, React Router
 
-**Chains:** Solana (AUDD SPL), Base (EVM / USDC), X1 EcoChain (EVM / USDT)
+**Chains:** Solana (AUDD SPL), Base (USDC EVM), X1 EcoChain (USDT EVM)
 
 **Protocol:** x402 HTTP payment standard
 
-- 
2.43.0
