const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.join(__dirname, "settings.db"), (err) => {
  console.log(__dirname);

  console.log(process.cwd());

  if (err) {
    console.error("Database connection error:", err.message);
  } else {
    console.log("Connected to SQLite database");
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
      validatedAtProperty TEXT
    )
  `);
  db.run(`
  CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
    portalId TEXT PRIMARY KEY,
    accessToken TEXT,
    refreshToken TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiresAt TEXT
  )
`);
});

module.exports = db;
