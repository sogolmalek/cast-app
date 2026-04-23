# Cast

**Instant API creation and monetization for the AI agent economy.**

Describe any API in one sentence. Cast generates a production-ready endpoint and deploys it at a unique URL in under 5 seconds. Every call settles a **$0.001 micropayment via the x402 protocol** — on-chain, with no API keys, no accounts, and no billing dashboards for callers.

---

## Quick Start

### Prerequisites

- Node.js 20+

### Setup

```bash
git clone https://github.com/your-username/cast.git
cd cast
chmod +x setup.sh && ./setup.sh
```

### Run

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- API directory: `http://localhost:3001/cast`

### Test

```bash
cd backend && node run-tests.js
# 28/28 passing
```

---

## How It Works

### For creators

1. Sign up and add your Claude API key (BYOK — Bring Your Own Key)
2. Describe your API in the Studio: *"An API that converts any currency to any other currency"*
3. Iterate — tell Cast to change the schema, add validation, modify logic
4. Deploy — one click, live URL, under 5 seconds
5. Earn — every call credits your balance with $0.001 USDC/USDT, settled on-chain

### For callers (agents / developers)

```bash
# Check what the endpoint expects
curl https://cast.dev/cast/my-endpoint-slug

# Call with x402 payment
PAYMENT=$(echo '{"chain":"starknet","proof":"0x_tx_hash","payer":"0x_address","amount":"1000","nonce":"abc123"}' | base64)

curl -X POST https://cast.dev/cast/my-endpoint-slug \
  -H "Content-Type: application/json" \
  -H "X-Payment: $PAYMENT" \
  -d '{"your": "input"}'
```

No API keys. No accounts. Just HTTP + an on-chain payment.

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
│  Starknet · Base · X1 EcoChain · add any EVM chain       │
└──────────────────────────────────────────────────────────┘
```

The payment layer is fully chain-agnostic. Any chain that implements the `PaymentVerifier` interface plugs in automatically.

---

## Supported Chains

| Chain | Type | Token | Status |
|---|---|---|---|
| **Starknet** | Cairo L2 | USDC | ✅ Native AA + Paymaster |
| **Base** | EVM L2 | USDC | ✅ x402 origin chain |
| **X1 EcoChain** | EVM L1 | USDT | ✅ DePIN / Web4 |
| Any EVM chain | EVM | any ERC-20 | Extend `BaseVerifier` |

### Adding a new chain (EVM)

```javascript
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
```javascript
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
  ├─ Dual nonce check (local DB + on-chain)
  │
  ├─ Route to chain adapter → verify()
  │
  ├─ Credit creator balance
  │
  └─ Execute in VM sandbox → response
```

---

## Project Structure

```
cast/
├── backend/src/
│   ├── adapters/
│   │   ├── PaymentVerifier.js      Abstract interface
│   │   ├── StarknetVerifier.js     Cairo: AA + Paymaster + SNIP-12
│   │   ├── BaseVerifier.js         EVM: Transfer event verification
│   │   ├── X1EcoChainVerifier.js   X1 EcoChain (extends BaseVerifier)
│   │   └── index.js                Registry + plugin system
│   ├── middleware/
│   │   ├── auth.js                 JWT
│   │   └── x402.js                 Payment gateway
│   ├── routes/
│   │   ├── auth.js                 Signup, login, BYOK key
│   │   ├── endpoints.js            Generate, iterate, deploy, test
│   │   ├── balance.js              Earnings + withdrawals
│   │   └── cast.js                 Public endpoint serving
│   └── services/
│       ├── generator.js            Claude API → endpoint code
│       └── runtime.js              Sandboxed VM execution
├── frontend/src/pages/
│   ├── Studio.jsx                  NL editor — core product
│   ├── Dashboard.jsx               Endpoint management
│   ├── EndpointDetail.jsx          Analytics + test + docs
│   ├── Balance.jsx                 Earnings + withdrawals
│   └── Settings.jsx                BYOK key + chain config
├── contracts/starknet/
│   └── cast_payment.cairo          Starknet payment contract
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

```env
# Server
PORT=3001
JWT_SECRET=<random 32+ chars>

# Starknet
STARKNET_RPC_URL=https://starknet-mainnet.public.blastapi.io
STARKNET_PAYMENT_CONTRACT=0x_deployed_contract
STARKNET_SIGNER_ADDRESS=0x_cast_signer
STARKNET_SIGNER_PRIVATE_KEY=0x_private_key
STARKNET_PAYMASTER_ENABLED=false

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

```bash
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

## Starknet Contract

Deploy the Cairo payment contract:

```bash
cd contracts/starknet
scarb build
starkli deploy target/dev/cast_payment_CastPayment.contract_class.json \
  --constructor-calldata \
    <owner_address> \
    <usdc_address> \
    100
```

---

## API Reference

### Auth
`POST /api/auth/signup` · `POST /api/auth/login` · `GET /api/auth/me` · `PUT /api/auth/claude-key`

### Endpoints
`GET /api/endpoints` · `POST /api/endpoints/generate` · `POST /api/endpoints/iterate` · `POST /api/endpoints/deploy` · `POST /api/endpoints/:id/test` · `GET /api/endpoints/:id/analytics`

### Balance
`GET /api/balance` · `POST /api/balance/withdraw` · `GET /api/balance/withdrawals`

### Public (x402)
`GET /cast` · `GET /cast/chains` · `GET /cast/chains/starknet/typed-data/:slug` · `GET /cast/:slug` · `POST /cast/:slug`

---

## Stack

**Backend:** Node.js 20, Express, SQLite (sql.js), JWT, starknet.js v6, ethers v6

**Frontend:** React 18, Vite, Tailwind CSS, React Router

**Chains:** Starknet (Cairo), Base (EVM), X1 EcoChain (EVM)

**Protocol:** x402 HTTP payment standard

**Infra:** Docker, Nginx, GitHub Actions CI

---

## License

MIT
