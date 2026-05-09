const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./settings.db", (err) => {
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
});

module.exports = db;