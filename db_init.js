const Database = require('better-sqlite3');

function initializeDatabase(dbPath = 'telemetry.db') {
  console.log(`Connecting to SQLite database at: ${dbPath}`);
  
  const db = new Database(dbPath);

  // Enable foreign key constraints in SQLite
  db.pragma('foreign_keys = ON');

  // Define database schema
  const schemaSql = `
    -- 1. Gateways Table
    CREATE TABLE IF NOT EXISTS gateways (
      gw TEXT PRIMARY KEY,
      site TEXT NOT NULL,
      fw INTEGER,
      uid TEXT,
      last_seen_ts INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Devices Table (Composite primary key: gw + node)
    CREATE TABLE IF NOT EXISTS devices (
      gw TEXT NOT NULL,
      node TEXT NOT NULL,
      site TEXT NOT NULL,
      addr INTEGER,
      state TEXT,
      last_seen_ts INTEGER,
      PRIMARY KEY (gw, node),
      FOREIGN KEY (gw) REFERENCES gateways(gw) ON DELETE CASCADE
    );

    -- 3. Telemetry Frames (Master record for each incoming MQTT packet)
    CREATE TABLE IF NOT EXISTS telemetry_frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site TEXT NOT NULL,
      gw TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      temp_val REAL,
      temp_unit TEXT DEFAULT 'C',
      temp_valid BOOLEAN DEFAULT 1,
      vdda_mv INTEGER,
      rssi INTEGER,
      heap_free INTEGER,
      raw_payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (gw) REFERENCES gateways(gw) ON DELETE CASCADE
    );

    -- 4. Device Telemetry Readings (Individual pump measurements)
    CREATE TABLE IF NOT EXISTS device_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      frame_id INTEGER NOT NULL,
      gw TEXT NOT NULL,
      node TEXT NOT NULL,
      state TEXT,
      i_l1 REAL,
      i_l2 REAL,
      i_l3 REAL,
      i_valid BOOLEAN DEFAULT 1,
      unbal_pct REAL,
      uptime_s INTEGER,
      starts INTEGER,
      FOREIGN KEY (frame_id) REFERENCES telemetry_frames(id) ON DELETE CASCADE,
      FOREIGN KEY (gw, node) REFERENCES devices(gw, node) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
    );


    -- Indexes for high performance querying
    CREATE INDEX IF NOT EXISTS idx_telemetry_frames_gw_ts ON telemetry_frames(gw, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_device_readings_gw_node ON device_readings(gw, node);
  `;

  // Execute schema setup
  db.exec(schemaSql);
  console.log('✅ Database schema successfully created/verified.');

  return db;
}

// Run setup if executed directly
if (require.main === module) {
  try {
    initializeDatabase();
  } catch (error) {
    console.error('❌ Database creation failed:', error.message);
  }
}

module.exports = initializeDatabase;