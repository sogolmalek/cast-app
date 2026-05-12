import app from './app.js';
import { config } from './config.js';
import { migrate } from './db.js';

// Prevent unhandled rejections from crashing the server
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err.message);
});

// Run migrations
console.log('Running database migrations...');
migrate();
console.log('Migrations complete.');

// Start server
app.listen(config.port, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║           Cast API Server             ║
  ║  The instant API layer for agents     ║
  ╠═══════════════════════════════════════╣
  ║  Port:     ${String(config.port).padEnd(26)}║
  ║  Chains:   ${config.payment.supportedChains.join(', ').padEnd(26)}║
  ║  Currency: ${config.payment.currency.padEnd(26)}║
  ╚═══════════════════════════════════════╝
  `);
});
