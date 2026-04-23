import initSqlJs from 'sql.js/dist/sql-asm.js';
import { config } from './config.js';
import fs from 'fs';
import path from 'path';

// Ensure data directory exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// Initialize sql.js synchronously (asm.js version, no WASM needed)
const SQL = await initSqlJs();

// Load existing database or create new one
let fileBuffer = null;
if (fs.existsSync(config.dbPath)) {
  fileBuffer = fs.readFileSync(config.dbPath);
}
const rawDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

// Enable foreign keys
rawDb.run('PRAGMA foreign_keys = ON;');

// Auto-save interval (flush to disk every 5 seconds if dirty)
let dirty = false;
function saveToDisk() {
  if (dirty) {
    const data = rawDb.export();
    fs.writeFileSync(config.dbPath, Buffer.from(data));
    dirty = false;
  }
}
setInterval(saveToDisk, 5000);
process.on('exit', saveToDisk);
process.on('SIGINT', () => { saveToDisk(); process.exit(); });
process.on('SIGTERM', () => { saveToDisk(); process.exit(); });

/**
 * Wrapper around sql.js that mimics the better-sqlite3 API:
 *   db.prepare(sql).get(...params)  → single row object or undefined
 *   db.prepare(sql).all(...params)  → array of row objects
 *   db.prepare(sql).run(...params)  → { changes: number }
 *   db.exec(sql)                    → void (multi-statement)
 *   db.transaction(fn)              → fn wrapped in BEGIN/COMMIT
 */
const db = {
  prepare(sql) {
    return {
      get(...params) {
        try {
          const stmt = rawDb.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            return row;
          }
          stmt.free();
          return undefined;
        } catch (err) {
          console.error('[db.get]', err.message, sql.slice(0, 80));
          return undefined;
        }
      },

      all(...params) {
        try {
          const stmt = rawDb.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          const rows = [];
          const cols = stmt.getColumnNames();
          while (stmt.step()) {
            const vals = stmt.get();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            rows.push(row);
          }
          stmt.free();
          return rows;
        } catch (err) {
          console.error('[db.all]', err.message, sql.slice(0, 80));
          return [];
        }
      },

      run(...params) {
        try {
          rawDb.run(sql, params);
          dirty = true;
          return { changes: rawDb.getRowsModified() };
        } catch (err) {
          console.error('[db.run]', err.message, sql.slice(0, 80));
          return { changes: 0 };
        }
      },
    };
  },

  exec(sql) {
    rawDb.exec(sql);
    dirty = true;
  },

  transaction(fn) {
    return (...args) => {
      rawDb.run('BEGIN');
      try {
        const result = fn(...args);
        rawDb.run('COMMIT');
        dirty = true;
        return result;
      } catch (err) {
        rawDb.run('ROLLBACK');
        throw err;
      }
    };
  },

  pragma(str) {
    rawDb.run(`PRAGMA ${str}`);
  },

  // Force save to disk
  flush() {
    dirty = true;
    saveToDisk();
  },
};

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      claude_api_key_encrypted TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS endpoints (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      generated_code TEXT NOT NULL,
      input_schema TEXT,
      output_schema TEXT,
      price_per_call REAL DEFAULT 0.001,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','archived')),
      version INTEGER DEFAULT 1,
      total_calls INTEGER DEFAULT 0,
      total_revenue REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS endpoint_versions (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      generated_code TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT REFERENCES endpoints(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      messages TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active' CHECK(status IN ('active','deployed','archived')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS call_logs (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      caller_address TEXT,
      chain TEXT NOT NULL,
      payment_proof TEXT,
      tx_hash TEXT,
      amount REAL NOT NULL,
      request_body TEXT,
      response_body TEXT,
      response_status INTEGER,
      latency_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS balances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chain TEXT NOT NULL,
      amount REAL DEFAULT 0,
      pending_amount REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, chain)
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chain TEXT NOT NULL,
      amount REAL NOT NULL,
      destination_address TEXT NOT NULL,
      tx_hash TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_endpoints_user ON endpoints(user_id);
    CREATE INDEX IF NOT EXISTS idx_endpoints_slug ON endpoints(slug);
    CREATE INDEX IF NOT EXISTS idx_call_logs_endpoint ON call_logs(endpoint_id);
    CREATE INDEX IF NOT EXISTS idx_call_logs_created ON call_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_balances_user ON balances(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
  `);
}

export default db;
