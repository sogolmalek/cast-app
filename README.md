README
 Describe any API in one sentence. Cast generates a production-ready endpoint and deploys it at a unique URL in under 5 seconds. Every call settles a **$0.001 micropayment via the x402 protocol** — on-chain, with no API keys, no accounts, and no billing dashboards for callers.
 
-Cast is chain-agnostic by design. The payment layer is built around a `PaymentVerifier` interface — any chain plugs in as an adapter. Currently supported: **Solana (AUDD)**, **Base (USDC)**, and **X1 EcoChain (USDT)**.
+The payment layer is chain-agnostic. Cast implements a `PaymentVerifier` interface that any chain plugs into as an adapter. Callers pay in whatever stablecoin their chain uses; creators withdraw to whichever address they choose. Currently supported: **Solana (AUDD)**, **Base (USDC)**, and **X1 EcoChain (USDT)**.
 
 ---
 
 ## Quick Start
 
-### Prerequisites
-
-* Node.js 20+
-
-### Setup
-
 ```
 git clone https://github.com/sogolmalek/cast-app.git
 cd cast-app
 chmod +x setup.sh && ./setup.sh
-```
-
-### Run
-
-```
 npm run dev
 ```
 
-* Frontend: `http://localhost:5173`
-* Backend: `http://localhost:3001`
-* API directory: `http://localhost:3001/cast`
-
-### Test
+- Frontend: `http://localhost:5173`
+- Backend: `http://localhost:3001`
 
 ```
 cd backend && node run-tests.js
@@ -43,115 +29,40 @@ cd backend && node run-tests.js
 
 ## How It Works
 
-### For creators
+**For creators:** sign up, add a Claude API key, describe your API in one sentence, deploy. Every call earns you $0.001 in the chain's stablecoin, credited on-chain.
 
-1. Sign up and add your Claude API key (BYOK — Bring Your Own Key)
-2. Describe your API in the Studio: *"An API that converts any currency to any other currency"*
-3. Iterate — tell Cast to change the schema, add validation, modify logic
-4. Deploy — one click, live URL, under 5 seconds
-5. Earn — every call credits your balance on-chain, in whichever currency your chain uses
-
-### For callers (agents / developers)
+**For callers (agents or developers):** send an HTTP request with an `X-Payment` header containing a base64-encoded payment proof. No accounts, no API keys.
 
 ```
-# Check what the endpoint expects and which chains are accepted
-curl https://cast.dev/cast/my-endpoint-slug
-
-# Call with x402 payment — Solana example (AUDD)
-PAYMENT=$(echo '{"chain":"solana","proof":"<base58 tx signature>","payer":"<solana address>","amount":"1000","nonce":"abc123"}' | base64)
+PAYMENT=$(echo '{"chain":"solana","proof":"<base58 tx sig>","payer":"<address>","amount":"1000","nonce":"abc123"}' | base64)
 
-# Call with x402 payment — Base example (USDC)
-PAYMENT=$(echo '{"chain":"base","proof":"0x_tx_hash","payer":"0x_address","amount":"1000","nonce":"abc123"}' | base64)
-
-curl -X POST https://cast.dev/cast/my-endpoint-slug \
+curl -X POST https://cast.dev/cast/my-endpoint \
   -H "Content-Type: application/json" \
   -H "X-Payment: $PAYMENT" \
-  -d '{"your": "input"}'
-```
-
-No API keys. No accounts. Just HTTP + an on-chain payment.
-
----
-
-## Architecture
-
-```
-┌──────────────────────────────────────────────────────────┐
-│  Cast Studio (frontend)                                  │
-│  NL editor · BYOK Claude key · Iterative chat · Test UI  │
-├──────────────────────────────────────────────────────────┤
-│  Cast Engine (backend)                                   │
-│  AI generation · VM sandbox runtime · API registry       │
-├──────────────────────────────────────────────────────────┤
-│  x402 Payment Gateway  —  chain agnostic                 │
-│  HTTP 402 intercept · Balance aggregation · Withdrawals  │
-├──────────────────────────────────────────────────────────┤
-│  Chain Adapters  —  plugin model                         │
-│  Solana (AUDD) · Base (USDC) · X1 EcoChain (USDT)        │
-└──────────────────────────────────────────────────────────┘
+  -d '{"your":"input"}'
 ```
 
----
-
-## Supported Chains
-
-| Chain | Type | Token | Status |
-| --- | --- | --- | --- |
-| **Solana** | L1 | **AUDD** (SPL) | ✅ Sub-cent fees, sub-second finality |
-| **Base** | EVM L2 | USDC | ✅ x402 origin chain |
-| **X1 EcoChain** | EVM L1 | USDT | ✅ DePIN / Web4 |
-| Any EVM chain | EVM | any ERC-20 | Extend `BaseVerifier` |
-
----
-
-## x402 Payment Flow
-
-```
-POST /cast/:slug
-  │
-  ├─ No X-Payment header → 402 { accepts: [{ chain, currency, amount, recipient }] }
-  │
-  ├─ Parse X-Payment (base64 JSON)
-  │   { chain, proof, payer, amount, nonce }
-  │
-  ├─ Dual nonce check (local DB + optional on-chain hook per adapter)
-  │
-  ├─ Route to chain adapter → verify()
-  │
-  ├─ Credit creator balance
-  │
-  └─ Execute in VM sandbox → response
-```
+If no payment header is sent, Cast returns `HTTP 402` with the accepted chains, amounts, and recipient addresses — everything the caller needs to construct the payment.
 
 ---
 
-## Solana — AUDD
-
-AUDD is Australia's fully-backed digital dollar stablecoin, deployed as an SPL token on Solana. Solana is Cast's primary chain for the following reasons: sub-cent transaction fees make $0.001 per-call settlements viable, finality is sub-second, and AUDD gives Australian creators AUD-denominated revenue without a second FX leg.
+## AUDD on Solana
 
-### How AUDD verification works
+AUDD is Australia's fully-backed digital dollar stablecoin, issued as an SPL token on Solana. Cast uses AUDD as its primary settlement asset for two reasons: Solana's sub-cent fees make $0.001 per-call payments viable, and AUDD gives Australian creators AUD-denominated revenue without a second FX conversion.
 
-`SolanaVerifier` takes a base58 transaction signature as the payment proof, fetches the confirmed transaction via RPC, and validates the payment using SPL token balance deltas (`preTokenBalances` vs `postTokenBalances`). This works regardless of whether the caller used a plain `Transfer`, `TransferChecked`, or a CPI'd transfer via Cast's own `cast-payment` Anchor program.
+### What we built
 
-For a payment to verify:
-- transaction must be confirmed with no error
-- recipient's AUDD balance must increase by at least the requested amount
-- payer's AUDD balance must decrease by at least the requested amount
-- mint on the token balance entries must equal the configured `SOLANA_AUDD_MINT`
-
-Replay protection: local DB nonce check first, then an optional on-chain lookup via `isNonceUsed(nonce)` that any adapter can implement.
-
-### Solana payment intent helper
-
-```
-GET /cast/chains/solana/payment-intent/:slug
-```
+**`SolanaVerifier`** — verifies x402 payments by fetching the caller's confirmed transaction via Solana RPC and checking SPL token balance deltas (`preTokenBalances` vs `postTokenBalances`) for the configured AUDD mint. Works whether the caller used a plain SPL `Transfer`, `TransferChecked`, or a CPI'd transfer through Cast's own Anchor program.
 
-Returns the full AUDD transfer intent — mint address, recipient, amount in smallest units, UI amount, network — plus an X-Payment header template ready to base64-encode. Useful for agents building the payment step automatically.
+For a payment to pass verification:
+- transaction is confirmed with no error
+- recipient's AUDD balance increased by at least the requested amount
+- payer's AUDD balance decreased by at least the requested amount
+- mint matches the configured `SOLANA_AUDD_MINT`
 
-### Cast Anchor program (optional)
+**`GET /cast/chains/solana/payment-intent/:slug`** — returns the full AUDD transfer intent for a given endpoint: mint address, recipient, amount in smallest units, UI amount, network. Designed for agents that need to construct the payment automatically.
 
-`contracts/solana/programs/cast-payment` provides `pay_and_record(amount, nonce_hash, endpoint_id)`: a single instruction that CPIs an SPL transfer of AUDD and writes a `PaymentReceipt` PDA at `["receipt", payer, nonce_hash]`. The PDA serves as a canonical on-chain replay guard. Callers who do not use the program can send a plain SPL transfer — the verifier handles both.
+**`cast-payment` Anchor program** (`contracts/solana/`) — optional on-chain component. A single instruction `pay_and_record(amount, nonce_hash, endpoint_id)` that CPIs an SPL transfer of AUDD and writes a `PaymentReceipt` PDA at `["receipt", payer, nonce_hash]`. The PDA is the replay guard — a second submission with the same nonce fails at account init. Callers who send a plain SPL transfer don't need the program; the verifier handles both.
 
 ```
 cd contracts/solana
@@ -159,13 +70,12 @@ anchor build
 anchor deploy --provider.cluster devnet
 ```
 
-### Solana environment variables
+### Environment variables
 
 ```
 SOLANA_NETWORK=devnet
 SOLANA_RPC_URL=https://api.devnet.solana.com
-SOLANA_COMMITMENT=confirmed
-SOLANA_AUDD_MINT=<AUDD SPL mint for your network>
+SOLANA_AUDD_MINT=<AUDD SPL mint address>
 SOLANA_AUDD_DECIMALS=6
 SOLANA_RECIPIENT_ADDRESS=<Cast recipient wallet>
 SOLANA_SIGNER_SECRET=<base58 secret, server-side only>
@@ -175,135 +85,32 @@ SOLANA_SIGNER_SECRET=<base58 secret, server-side only>
 
 ## X1 EcoChain — USDT
 
-X1 EcoChain is an EVM-compatible L1 designed for DePIN and Web4 workloads. Cast integrates X1 via `X1EcoChainVerifier`, which extends the EVM `BaseVerifier` and overrides the chain-specific config (RPC URL, chain ID, USDT contract address).
+X1 EcoChain is an EVM-compatible L1 built for DePIN and Web4. Cast integrates X1 as a settlement chain via `X1EcoChainVerifier`, making Cast the first x402 micropayment API layer on X1.
 
-X1 is a natural fit for Cast's per-call payment model: low-power nodes and sub-cent fees make micropayment settlement practical, and the USDT integration (planned Q4 2025 per X1 roadmap) gives callers a stable settlement asset.
+### What we built
 
-### How X1 verification works
+**`X1EcoChainVerifier`** — extends Cast's EVM `BaseVerifier` and overrides the chain-specific config: RPC URL (`https://maculatus-rpc.x1eco.com/`), chain ID (10778 testnet), and USDT contract address. Verification fetches the transaction receipt and finds an ERC-20 `Transfer(address,address,uint256)` event on the USDT contract, confirming sender, recipient, and amount match the payment claim.
 
-`X1EcoChainVerifier` fetches the transaction receipt and looks for an ERC-20 `Transfer(address,address,uint256)` event on the configured USDT contract, confirming the sender, recipient, and amount match the payment claim. The logic is identical to Base — only the RPC URL, chain ID, and token contract differ.
+The logic is identical to Base — only the config differs. Any EVM chain can be added the same way in under 20 lines by extending `BaseVerifier`.
 
-### X1 environment variables
+### Environment variables
 
 ```
 X1_NETWORK=testnet
 X1_RPC_URL=https://maculatus-rpc.x1eco.com/
 X1_CHAIN_ID=10778
 X1_USDT_ADDRESS=<USDT contract on X1>
-X1_RECIPIENT_ADDRESS=<Cast recipient address on X1>
+X1_RECIPIENT_ADDRESS=<Cast recipient on X1>
 X1_EXPLORER_URL=https://maculatus-scan.x1eco.com/
 ```
 
 ---
 
-## Base — USDC
-
-Base is where the x402 protocol originated. Cast's `BaseVerifier` handles standard ERC-20 USDC transfer verification via transaction receipt + Transfer event log parsing. It also serves as the base class for any additional EVM chain.
-
-```
-BASE_RPC_URL=https://mainnet.base.org
-BASE_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
-BASE_RECIPIENT_ADDRESS=0x_your_address
-```
-
-### Adding a new EVM chain
-
-```js
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
-Register in `adapters/index.js` and add to `config.payment.supportedChains`. Done.
-
----
-
-## Project Structure
-
-```
-cast/
-├── backend/src/
-│   ├── adapters/
-│   │   ├── PaymentVerifier.js      Abstract interface
-│   │   ├── SolanaVerifier.js       AUDD SPL token balance delta verification
-│   │   ├── BaseVerifier.js         EVM: Transfer event verification (Base + any EVM)
-│   │   ├── X1EcoChainVerifier.js   X1 EcoChain USDT (extends BaseVerifier)
-│   │   └── index.js                Registry + plugin system
-│   ├── middleware/
-│   │   ├── auth.js                 JWT
-│   │   └── x402.js                 Chain-agnostic payment gateway
-│   ├── routes/
-│   │   ├── auth.js                 Signup, login, BYOK key
-│   │   ├── endpoints.js            Generate, iterate, deploy, test
-│   │   ├── balance.js              Earnings + withdrawals
-│   │   └── cast.js                 Public endpoint serving + chain helpers
-│   └── services/
-│       ├── generator.js            Claude API → endpoint code
-│       └── runtime.js              Sandboxed VM execution
-├── frontend/src/pages/
-│   ├── Studio.jsx                  NL editor — core product
-│   ├── Dashboard.jsx               Endpoint management
-│   ├── EndpointDetail.jsx          Analytics + test + docs
-│   ├── Balance.jsx                 Earnings + withdrawals (Solana / Base / X1)
-│   └── Settings.jsx                BYOK key + chain config
-├── contracts/solana/
-│   └── programs/cast-payment/      Anchor program: atomic pay + nonce registry PDA
-├── .github/workflows/
-│   ├── ci.yml                      Test + build on push
-│   └── deploy.yml                  Production deploy
-├── Dockerfile
-├── docker-compose.yml
-├── nginx.conf
-└── setup.sh
-```
-
----
-
-## Deploy to Production
-
-```
-# Docker
-cp backend/.env.example backend/.env  # configure all chain vars
-docker compose up -d
-curl http://localhost:3001/health
-
-# Manual
-./setup.sh
-cd frontend && npm run build
-NODE_ENV=production node backend/src/index.js
-```
-
----
-
-## API Reference
-
-### Auth
-`POST /api/auth/signup` · `POST /api/auth/login` · `GET /api/auth/me` · `PUT /api/auth/claude-key`
-
-### Endpoints
-`GET /api/endpoints` · `POST /api/endpoints/generate` · `POST /api/endpoints/iterate` · `POST /api/endpoints/deploy` · `POST /api/endpoints/:id/test` · `GET /api/endpoints/:id/analytics`
-
-### Balance
-`GET /api/balance` · `POST /api/balance/withdraw` · `GET /api/balance/withdrawals`
-
-### Public (x402)
-`GET /cast` · `GET /cast/chains` · `GET /cast/chains/solana/payment-intent/:slug` · `GET /cast/:slug` · `POST /cast/:slug`
-
----
-
 ## Stack
 
-**Backend:** Node.js 20, Express, SQLite (sql.js), JWT, @solana/web3.js, @solana/spl-token, ethers v6
+**Backend:** Node.js 20, Express, SQLite, @solana/web3.js, @solana/spl-token, ethers v6
 
-**Frontend:** React 18, Vite, Tailwind CSS, React Router
+**Frontend:** React 18, Vite, Tailwind CSS
 
 **Chains:** Solana (AUDD SPL), Base (USDC EVM), X1 EcoChain (USDT EVM)
 
-- 
2.43.0
