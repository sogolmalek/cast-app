import 'dotenv/config';

export const config = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'cast-dev-secret-change-in-prod',
  jwtExpiry: '7d',
  dbPath: process.env.DB_PATH || './data/cast.db',

  // x402 payment config
  payment: {
    defaultPricePerCall: 0.001,
    currency: 'USDC/USDT',
    supportedChains: ['starknet', 'base', 'x1ecochain'],
    defaultChain: 'starknet',
  },

  // Starknet config
  starknet: {
    rpcUrl: process.env.STARKNET_RPC_URL || 'https://starknet-mainnet.public.blastapi.io',
    chainId: process.env.STARKNET_CHAIN_ID || 'SN_MAIN',
    paymentContractAddress: process.env.STARKNET_PAYMENT_CONTRACT || '',
    usdcAddress: process.env.STARKNET_USDC_ADDRESS || '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    // Cast's server-side account for settlements and paymaster
    signerAddress: process.env.STARKNET_SIGNER_ADDRESS || '',
    signerPrivateKey: process.env.STARKNET_SIGNER_PRIVATE_KEY || '',
    // Paymaster
    paymasterEnabled: process.env.STARKNET_PAYMASTER_ENABLED === 'true',
    maxGasSubsidyUsd: parseFloat(process.env.STARKNET_MAX_GAS_SUBSIDY || '0.0005'),
    // Verification
    receiptPollIntervalMs: 2000,
    receiptPollMaxAttempts: 15,
    acceptPendingTx: process.env.STARKNET_ACCEPT_PENDING === 'true',
  },

  // Base config
  base: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    usdcAddress: process.env.BASE_USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },

  // X1 EcoChain config
  // Testnet: Chain ID 10778, RPC https://maculatus-rpc.x1eco.com/
  // Explorer: https://maculatus-scan.x1eco.com/
  x1ecochain: {
    network: process.env.X1_NETWORK || 'testnet',
    rpcUrl: process.env.X1_RPC_URL || 'https://maculatus-rpc.x1eco.com/',
    chainId: parseInt(process.env.X1_CHAIN_ID || '10778'),
    // USDT address — set after deploying or use official Tether integration (Q4 2025 roadmap)
    usdtAddress: process.env.X1_USDT_ADDRESS || '',
    recipientAddress: process.env.X1_RECIPIENT_ADDRESS || '',
    explorerUrl: process.env.X1_EXPLORER_URL || 'https://maculatus-scan.x1eco.com/',
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
