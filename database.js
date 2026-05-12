const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.join(__dirname, "settings.db"), (err) => {
  if (process.env.NODE_ENV !== "test") {
    if (err) {
      console.error("Database connection error:", err.message);
    } else {
      console.log("Connected to SQLite database");
    }
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portalId TEXT UNIQUE,
    phoneProperty TEXT,
    validationStatusProperty TEXT,
    carrierProperty TEXT,
    validatedAtProperty TEXT,
    veracityApiKey TEXT,
    rateLimitPerHour INTEGER DEFAULT 100,
    retentionDays INTEGER DEFAULT 30,
    overwriteExisting INTEGER DEFAULT 1,
    maxRequestsPerSecond INTEGER DEFAULT 10,
    maxConcurrentWorkers INTEGER DEFAULT 1,
    failureReasonProperty TEXT,
    normalizedPhoneProperty TEXT,
    storeNormalizedPhone INTEGER
  )
  `);

  // db.run(`ALTER TABLE mappings ADD COLUMN veracityApiKey TEXT`);
  // db.run(
  //   `ALTER TABLE mappings ADD COLUMN rateLimitPerHour INTEGER DEFAULT 100`,
  // );
  // db.run(`ALTER TABLE mappings ADD COLUMN retentionDays INTEGER DEFAULT 30`);

  db.run(`
  CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
    portalId TEXT UNIQUE,
    accessToken TEXT,
    refreshToken TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiresAt TEXT
  )
`);

  db.run(`
  CREATE TABLE IF NOT EXISTS validation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portalId TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

  db.run(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portalId TEXT,
    contactId TEXT,
    action TEXT,
    status TEXT,
    message TEXT,
    carrier TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS batch_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portalId TEXT,
    listId TEXT,
    status TEXT,
    total INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0,
    valid INTEGER DEFAULT 0,
    invalid INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    `);
});

module.exports = db;
