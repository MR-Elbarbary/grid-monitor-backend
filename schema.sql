CREATE TABLE IF NOT EXISTS macHash (
    macID TEXT PRIMARY KEY NOT NULL,
    hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    macID TEXT,
    FOREIGN KEY (macID) REFERENCES macHash(macID)
);

CREATE TABLE IF NOT EXISTS device (
    deviceID TEXT PRIMARY KEY NOT NULL,
    macID TEXT,
    deviceName TEXT NOT NULL DEFAULT 'device',
    FOREIGN KEY (macID) REFERENCES macHash(macID)
);

CREATE TABLE IF NOT EXISTS deviceData (
    dataID INTEGER PRIMARY KEY AUTOINCREMENT,
    deviceID TEXT,
    current REAL NOT NULL,
    voltage REAL NOT NULL,
    temperature REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deviceID) REFERENCES device(deviceID)
);

INSERT INTO macHash (macID, hash) VALUES 
('00:1A:2B:3C:4D:5E', 'hash1'), 
('11:22:33:44:55:66', 'hash2'), 
('AA:BB:CC:DD:EE:FF', 'hash3'), 
('77:88:99:AA:BB:CC', 'hash4'), 
('12:34:56:78:9A:BC', 'hash5');