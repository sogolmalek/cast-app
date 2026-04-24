# Cast

**Instant API creation and monetization for the AI agent economy, settled in AUDD on Solana.**

Describe any API in one sentence. Cast generates a production-ready endpoint and deploys it at a unique URL in under 5 seconds. Every call settles a **$0.001 micropayment via the x402 protocol** — on-chain, with no API keys, no accounts, and no billing dashboards for callers.

Cast's native settlement asset is **AUDD**, Australia's fully-backed digital dollar stablecoin, as an SPL token on Solana. Base (USDC) and X1 EcoChain (USDT) are also supported via chain adapters.

---

## Quick Start

### Prerequisites

* Node.js 20+

### Setup

```
git clone https://github.com/sogolmalek/cast-app.git
cd cast-app
chmod +x setup.sh && ./setup.sh
```

### Run

```
npm run dev
```

* Frontend: `http://localhost:5173`
* Backend: `http://localhost:3001`
* API directory: `http://localhost:3001/cast`

### Test

```
cd backend && node run-tests.js
```

---

## How It Works

### For creators

1. Sign up and add your Claude API key (BYOK — Bring Your Own Key)
2. Describe your API in the Studio: *"An API that converts any currency to any other currency"*
3. Iterate — tell Cast to change the schema, add validation, modify logic
4. Deploy — one click, live URL, under 5 seconds
5. Earn — every call credits your balance with $0.001 AUDD, settled on-chain

### For callers (agents / developers)

```
# Check what the endpoint expects
curl https://cast.dev/cast/my-endpoint-slug

# Call with x402 payment (Solana / AUDD)
PAYMENT=$(echo '{"chain":"solana","proof":"<base58 tx signature>","payer":"<your Solana address>","amount":"1000","nonce":"abc123"}' | base64)

curl -X POST https://cast.dev/cast/my-endpoint-slug \
  -H "Content-Type: application/json" \
  -H "X-Payment: $PAYMENT" \
  -d '{"your": "input"}'
```

No API keys. No accounts. Just HTTP + an on-chain AUDD transfer.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Cast Studio (frontend)                                  │
│  NL editor · BYOK Claude key · Iterative chat · Test UI  │
├──────────────────────────────────────────────────────────┤
│  Cast Engine (backend)                                   │
│  AI generation · VM sandbox runtime · API registry       │
├──────────────────────────────────────────────────────────┤
│  x402 Payment Gateway  —  chain agnostic                 │
│  HTTP 402 intercept · Balance aggregation · Withdrawals  │
├──────────────────────────────────────────────────────────┤
│  Chain Adapters  —  plugin model                         │
│  Solana (AUDD) · Base (USDC) · X1 EcoChain (USDT)        │
└──────────────────────────────────────────────────────────┘
```

The payment layer is fully chain-agnostic. Any chain that implements the `PaymentVerifier` interface plugs in automatically.

---

## Supported Chains

| Chain | Type | Token | Status |
| --- | --- | --- | --- |
| **Solana** | L1 | **AUDD** (SPL) | ✅ Native — sub-cent fees, sub-second finality |
| **Base** | EVM L2 | USDC | ✅ x402 origin chain |
| **X1 EcoChain** | EVM L1 | USDT | ✅ DePIN / Web4 |
| Any EVM chain | EVM | any ERC-20 | Extend `BaseVerifier` |

### Adding a new chain (EVM)

```
import { BaseVerifier } from './BaseVerifier.js';

export class MyChainVerifier extends BaseVerifier {
  constructor() {
    super();
    this.chainId = 'mychain';
    this.rpcUrl = 'https://rpc.mychain.io';
    this.recipientAddress = '0x_your_address';
  }
  getRecipientAddress() { return this.recipientAddress; }
}
```

Register in `adapters/index.js`:

```
verifiers.set('mychain', new MyChainVerifier());
```

Add to `config.payment.supportedChains`. Done.

---

## x402 Payment Flow

```
POST /cast/:slug
  │
  ├─ No X-Payment header → 402 { accepts: [{ chain, amount, recipient }] }
  │
  ├─ Parse X-Payment (base64 JSON)
  │   { chain, proof, payer, amount, nonce }
  │
  ├─ Dual nonce check (local DB + optional on-chain hook)
  │
  ├─ Route to chain adapter → verify()
  │     Solana: fetch tx, confirm AUDD balance delta matches
  │     Base/X1: fetch receipt, parse Transfer event
  │
  ├─ Credit creator balance
  │
  └─ Execute in VM sandbox → response
```

---

## How AUDD Verification Works

Cast's `SolanaVerifier` takes a base58 transaction signature as the payment proof, fetches the confirmed tx via RPC, and validates the payment using **SPL token balance deltas** (`preTokenBalances` vs `postTokenBalances`). This approach works whether the caller used a plain SPL `Transfer`, `TransferChecked`, or a CPI'd transfer via another program (including Cast's own `cast-payment` Anchor program).

Concretely, for a payment to verify:

- the transaction must be confirmed and have no error
- the recipient's AUDD balance must increase by at least the requested amount
- the payer's AUDD balance must decrease by at least the requested amount
- the mint on the token balance entries must equal the configured `SOLANA_AUDD_MINT`

Replay protection is layered: local DB nonce check first, then an optional on-chain nonce lookup that any adapter can implement (`isNonceUsed(nonce)`).

---

## Project Structure

```
cast/
├── backend/src/
│   ├── adapters/
│   │   ├── PaymentVerifier.js      Abstract interface
│   │   ├── SolanaVerifier.js       Solana: SPL token balance delta verification for AUDD
│   │   ├── BaseVerifier.js         EVM: Transfer event verification
│   │   ├── X1EcoChainVerifier.js   X1 EcoChain (extends BaseVerifier)
│   │   └── index.js                Registry + plugin system
│   ├── middleware/
│   │   ├── auth.js                 JWT
│   │   └── x402.js                 Chain-agnostic payment gateway
│   ├── routes/
│   │   ├── auth.js                 Signup, login, BYOK key
│   │   ├── endpoints.js            Generate, iterate, deploy, test
│   │   ├── balance.js              Earnings + withdrawals
│   │   └── cast.js                 Public endpoint serving + Solana payment-intent helper
│   └── services/
│       ├── generator.js            Claude API → endpoint code
│       └── runtime.js              Sandboxed VM execution
├── frontend/src/pages/
│   ├── Studio.jsx                  NL editor — core product
│   ├── Dashboard.jsx               Endpoint management
│   ├── EndpointDetail.jsx          Analytics + test + docs
│   ├── Balance.jsx                 Earnings + withdrawals
│   └── Settings.jsx                BYOK key + chain config
├── contracts/solana/
│   └── programs/cast-payment/      Anchor program: atomic pay + nonce registry
├── .github/workflows/
│   ├── ci.yml                      Test + build on push
│   └── deploy.yml                  Production deploy
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
└── setup.sh
```

---

## Environment Variables

```
# Server
PORT=3001
JWT_SECRET=<random 32+ chars>

# Solana / AUDD (native chain)
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_COMMITMENT=confirmed
SOLANA_AUDD_MINT=<AUDD SPL mint for the chosen network>
SOLANA_AUDD_DECIMALS=6
SOLANA_RECIPIENT_ADDRESS=<Cast recipient wallet>
SOLANA_SIGNER_SECRET=<base58 secret, server-side only>

# Base
BASE_RPC_URL=https://mainnet.base.org
BASE_RECIPIENT_ADDRESS=0x_your_address

# X1 EcoChain
X1_NETWORK=testnet
X1_RPC_URL=https://maculatus-rpc.x1eco.com/
X1_CHAIN_ID=10778
X1_USDT_ADDRESS=0x_usdt_on_x1
X1_RECIPIENT_ADDRESS=0x_your_address
```

See `backend/.env.example` for all options.

---

## Deploy to Production

```
# Docker
cp backend/.env.example backend/.env  # configure
docker compose up -d
curl http://localhost:3001/health

# Manual
./setup.sh
cd frontend && npm run build
NODE_ENV=production node backend/src/index.js
```

---

## Solana Program (optional)

Cast ships an Anchor program, `cast-payment`, under `contracts/solana/`. The off-chain verifier does **not** require it — it verifies any confirmed AUDD transfer by balance delta. The program is provided for callers who want atomic pay-and-record in a single transaction, with a per-(payer, nonce) PDA receipt that serves as a canonical on-chain replay guard.

Build and deploy:

```
cd contracts/solana
anchor build
anchor deploy --provider.cluster devnet
```

The program exposes a single instruction, `pay_and_record(amount, nonce_hash, endpoint_id)`, which CPIs an SPL `transfer` of AUDD from the payer to the recipient and initializes a `PaymentReceipt` PDA at `["receipt", payer, nonce_hash]`. Re-submitting the same nonce fails at account init — that is the replay guard.

---

## API Reference

### Auth

`POST /api/auth/signup` · `POST /api/auth/login` · `GET /api/auth/me` · `PUT /api/auth/claude-key`

### Endpoints

`GET /api/endpoints` · `POST /api/endpoints/generate` · `POST /api/endpoints/iterate` · `POST /api/endpoints/deploy` · `POST /api/endpoints/:id/test` · `GET /api/endpoints/:id/analytics`

### Balance

`GET /api/balance` · `POST /api/balance/withdraw` · `GET /api/balance/withdrawals`

### Public (x402)

`GET /cast` · `GET /cast/chains` · `GET /cast/chains/solana/payment-intent/:slug` · `GET /cast/:slug` · `POST /cast/:slug`

---

## Stack

**Backend:** Node.js 20, Express, SQLite (sql.js), JWT, @solana/web3.js, @solana/spl-token, ethers v6

**Frontend:** React 18, Vite, Tailwind CSS, React Router

**Chains:** Solana (AUDD SPL), Base (EVM / USDC), X1 EcoChain (EVM / USDT)

**Protocol:** x402 HTTP payment standard

**Infra:** Docker, Nginx, GitHub Actions CI

---

## License

MIT
