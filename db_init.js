const Database = require('better-sqlite3');

function initializeDatabase(dbPath = 'telemetry.db') {
  console.log(`Connecting to SQLite database at: ${dbPath}`);

  const db = new Database(dbPath);

  // Enable foreign key constraints in SQLite
  db.pragma('foreign_keys = ON');

  // Recommended for telemetry workloads
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  const schemaSql = `
    -- ============================================================
    -- 1. Gateways
    -- ============================================================
    CREATE TABLE IF NOT EXISTS gateways (
      gw TEXT PRIMARY KEY,
      site TEXT NOT NULL,
      fw INTEGER,
      uid TEXT,
      last_seen_ts INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    -- ============================================================
    -- 2. Devices
    --
    -- One gateway can have multiple devices/pumps.
    -- Composite PK because node IDs are only unique within a gateway.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS devices (
      gw TEXT NOT NULL,
      node TEXT NOT NULL,
      site TEXT NOT NULL,
      addr INTEGER,
      state TEXT,
      last_seen_ts INTEGER,
      PRIMARY KEY (gw, node),

      FOREIGN KEY (gw)
        REFERENCES gateways(gw)
        ON DELETE CASCADE
    );


    -- ============================================================
    -- 3. Telemetry Frames
    --
    -- One row for every MQTT packet received.
    -- This preserves the original packet and gateway-level data.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS telemetry_frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      site TEXT NOT NULL,
      gw TEXT NOT NULL,

      seq INTEGER NOT NULL,
      ts INTEGER NOT NULL,

      vdda_mv INTEGER,
      rssi INTEGER,
      heap_free INTEGER,

      -- Original MQTT JSON
      raw_payload TEXT NOT NULL,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (gw)
        REFERENCES gateways(gw)
        ON DELETE CASCADE
    );


    -- ============================================================
    -- 4. Sensors
    --
    -- Defines which sensors/measurements a device has.
    --
    -- Example:
    --
    -- pump-01 | current_l1  | A   | number
    -- pump-01 | current_l2  | A   | number
    -- pump-01 | temperature | C   | number
    -- pump-01 | running     |     | boolean
    --
    -- New sensors can be added without changing the DB schema.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS sensors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      gw TEXT NOT NULL,
      node TEXT NOT NULL,

      name TEXT NOT NULL,
      unit TEXT,
      data_type TEXT NOT NULL DEFAULT 'number',

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (gw, node)
        REFERENCES devices(gw, node)
        ON DELETE CASCADE,

      UNIQUE (gw, node, name)
    );


    -- ============================================================
    -- 5. Historical Sensor Readings
    --
    -- One row = one sensor measurement at one point in time.
    --
    -- Example:
    --
    -- pump-01 | temperature | 2026... | 67.2
    -- pump-01 | current_l1  | 2026... | 12.4
    -- pump-01 | pressure    | 2026... | 4.2
    --
    -- This table can grow large because it stores history.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      sensor_id INTEGER NOT NULL,
      frame_id INTEGER NOT NULL,

      ts INTEGER NOT NULL,

      -- Flexible value representation.
      -- Only one of these should normally be populated depending
      -- on sensors.data_type.
      value_num REAL,
      value_text TEXT,
      value_bool BOOLEAN,

      valid BOOLEAN DEFAULT 1,

      FOREIGN KEY (sensor_id)
        REFERENCES sensors(id)
        ON DELETE CASCADE,

      FOREIGN KEY (frame_id)
        REFERENCES telemetry_frames(id)
        ON DELETE CASCADE
    );


    -- ============================================================
    -- 6. Current Readings
    --
    -- This is the important optimization for your SCADA UI.
    --
    -- Instead of searching sensor_readings for MAX(ts) every time,
    -- this table contains only the latest value for each sensor.
    -- ============================================================
    CREATE TABLE IF NOT EXISTS current_readings (
      sensor_id INTEGER PRIMARY KEY,

      frame_id INTEGER NOT NULL,

      ts INTEGER NOT NULL,

      value_num REAL,
      value_text TEXT,
      value_bool BOOLEAN,

      valid BOOLEAN DEFAULT 1,

      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (sensor_id)
        REFERENCES sensors(id)
        ON DELETE CASCADE,

      FOREIGN KEY (frame_id)
        REFERENCES telemetry_frames(id)
        ON DELETE CASCADE
    );


    -- ============================================================
    -- 7. Users
    -- ============================================================
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );


    -- ============================================================
    -- INDEXES
    -- ============================================================

    -- Latest gateway frames
    CREATE INDEX IF NOT EXISTS idx_frames_gw_ts
      ON telemetry_frames(gw, ts DESC);

    -- Device lookup
    CREATE INDEX IF NOT EXISTS idx_devices_gw_node
      ON devices(gw, node);

    -- Sensor lookup by device
    CREATE INDEX IF NOT EXISTS idx_sensors_device
      ON sensors(gw, node);

    -- Historical readings
    CREATE INDEX IF NOT EXISTS idx_sensor_readings_sensor_ts
      ON sensor_readings(sensor_id, ts DESC);

    -- Frame lookup
    CREATE INDEX IF NOT EXISTS idx_sensor_readings_frame
      ON sensor_readings(frame_id);

    -- Useful when querying recent readings across devices
    CREATE INDEX IF NOT EXISTS idx_sensor_readings_ts
      ON sensor_readings(ts DESC);
  `;

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