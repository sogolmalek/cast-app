import 'dotenv/config';

export const config = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'cast-dev-secret-change-in-prod',
  jwtExpiry: '7d',
  dbPath: process.env.DB_PATH || './data/cast.db',

  // x402 payment config
  payment: {
    defaultPricePerCall: 0.001,
    currency: 'AUDD',
    supportedChains: ['solana', 'base'],
    defaultChain: 'solana',
  },

  // Solana / AUDD config
  // AUDD is Australia's fully-backed digital dollar stablecoin, issued as an
  // SPL token on Solana. 6 decimals per SPL convention.
  // Mainnet RPC: https://api.mainnet-beta.solana.com
  // Devnet RPC:  https://api.devnet.solana.com
  solana: {
    network: process.env.SOLANA_NETWORK || 'devnet',
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    commitment: process.env.SOLANA_COMMITMENT || 'confirmed',
    // AUDD SPL mint address (set to the official AUDD mint for the chosen network)
    auddMint: process.env.SOLANA_AUDD_MINT || '',
    auddDecimals: parseInt(process.env.SOLANA_AUDD_DECIMALS || '6'),
    // Cast's recipient wallet (receives AUDD from callers)
    recipientAddress: process.env.SOLANA_RECIPIENT_ADDRESS || '',
    // Server-side signer for settlements (base58 secret key, kept server-side)
    signerSecret: process.env.SOLANA_SIGNER_SECRET || '',
    explorerUrl: process.env.SOLANA_EXPLORER_URL || 'https://explorer.solana.com',
  },

  // Base config
  base: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    usdcAddress: process.env.BASE_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },

  // Runtime config
  runtime: {
    timeoutMs: 10_000,
    maxMemoryMb: 128,
    maxResponseSize: 1_048_576, // 1MB
  },

  // Rate limits
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
    castCallWindowMs: 60 * 1000,
    castCallMaxRequests: 60,
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  }
};
