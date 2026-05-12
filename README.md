
# Cast

**Instant API creation and monetization for the AI agent economy.**

Describe any API in one sentence. Cast generates a production-ready endpoint and deploys it at a unique URL in under 5 seconds. Every call settles a $0.001 micropayment via the x402 protocol — on-chain, with no API keys, no accounts, and no billing dashboards for callers.

The payment layer is chain-agnostic. Currently supported: Solana (AUDD) and Base (USDC).

---

## Quick Start

```
git clone https://github.com/sogolmalek/cast-app.git
cd cast-app
chmod +x setup.sh && ./setup.sh
npm run dev
```

Frontend: http://localhost:5174/
Backend: http://localhost:3001

```
cd backend && node run-tests.js
# 28/28 passing
```

---

## How It Works

For creators: sign up, add an AI API key (Anthropic, OpenAI, Groq, or OpenRouter — free tiers available), describe your API in one sentence, deploy. Every call earns $0.001 in stablecoin, credited on-chain.

For callers: send an HTTP request with an X-Payment header containing a base64-encoded payment proof. No accounts, no API keys. If no payment header is sent, Cast returns HTTP 402 with the accepted chains, amounts, and recipient addresses.

---
**What we built:**

SolanaVerifier verifies payments by fetching the confirmed transaction via RPC and checking SPL token balance deltas for the AUDD mint. Works with plain SPL Transfer, TransferChecked, or CPI transfers.

GET /cast/chains/solana/payment-intent/:slug returns the full AUDD transfer intent for a given endpoint — mint, recipient, amount, network — for agents that build the payment step automatically.

cast-payment Anchor program (contracts/solana/) provides pay_and_record(amount, nonce_hash, endpoint_id): atomically CPIs an SPL transfer of AUDD and writes a PaymentReceipt PDA as an on-chain replay guard. Plain SPL transfers also work — the verifier handles both.

**Environment variables:**

```
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_AUDD_MINT=
SOLANA_AUDD_DECIMALS=6
SOLANA_RECIPIENT_ADDRESS=
SOLANA_SIGNER_SECRET=
```

---

## Stack

Backend: Node.js 20, Express, SQLite, @solana/web3.js, ethers v6

Frontend: React 18, Vite, Tailwind CSS

Protocol: x402

Infra: Docker, Nginx, GitHub Actions

---

MIT License
