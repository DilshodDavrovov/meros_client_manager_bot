const Database = require('better-sqlite3');
const path = require('path');
const logger = require('../utils/logger');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'meros_bot.db');
let db = null;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function query(sql, params = []) {
  const database = getDb();
  const stmt = database.prepare(sql);
  if (sql.trim().toUpperCase().startsWith('SELECT')) {
    return stmt.all(...params);
  }
  const info = stmt.run(...params);
  return info;
}

async function runInTransactionAsync(fn) {
  const database = getDb();
  database.exec('BEGIN');
  try {
    await fn();
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

async function initSchema() {
  const createTable = `
    CREATE TABLE IF NOT EXISTS client_deferral_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT NOT NULL,
      old_deferral_value TEXT NOT NULL,
      new_deferral_value TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RESTORED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      restored_at TEXT NULL
    )
  `;
  getDb().exec(createTable);
  try {
    getDb().exec('ALTER TABLE client_deferral_history ADD COLUMN client_name TEXT DEFAULT ""');
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  getDb().exec('CREATE INDEX IF NOT EXISTS idx_status_end_date ON client_deferral_history(status, end_date)');
  getDb().exec('CREATE INDEX IF NOT EXISTS idx_person_id ON client_deferral_history(person_id)');

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS allowed_users (
      telegram_user_id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  logger.info('Database schema initialized', DB_PATH);
}

module.exports = {
  query,
  getDb,
  initSchema,
  runInTransactionAsync,
};
