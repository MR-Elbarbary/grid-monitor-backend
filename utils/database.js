const initializeDatabase = require('../db_init');

const db = initializeDatabase();

const upsertGateway = db.prepare(`
  INSERT INTO gateways (gw, site, fw, uid, last_seen_ts)
  VALUES (@gw, @site, @fw, @uid, @ts)
  ON CONFLICT(gw) DO UPDATE SET
    site = excluded.site,
    fw = excluded.fw,
    uid = excluded.uid,
    last_seen_ts = excluded.last_seen_ts,
    updated_at = CURRENT_TIMESTAMP
`);

const upsertDevice = db.prepare(`
  INSERT INTO devices (gw, node, site, addr, state, last_seen_ts)
  VALUES (@gw, @node, @site, @addr, @state, @ts)
  ON CONFLICT(gw, node) DO UPDATE SET
    site = excluded.site,
    addr = excluded.addr,
    state = excluded.state,
    last_seen_ts = excluded.last_seen_ts
`);

const insertFrame = db.prepare(`
  INSERT INTO telemetry_frames (site, gw, seq, ts, vdda_mv, rssi, heap_free, raw_payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const findSensor = db.prepare(
  'SELECT id FROM sensors WHERE gw = ? AND node = ? AND name = ?'
);

const insertSensor = db.prepare(`
  INSERT INTO sensors (gw, node, name, unit, data_type)
  VALUES (?, ?, ?, ?, ?)
`);

const insertSensorReading = db.prepare(`
  INSERT INTO sensor_readings (sensor_id, frame_id, ts, value_num, valid)
  VALUES (?, ?, ?, ?, ?)
`);

const upsertCurrentReading = db.prepare(`
  INSERT INTO current_readings (sensor_id, frame_id, ts, value_num, valid)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(sensor_id) DO UPDATE SET
    frame_id = excluded.frame_id,
    ts = excluded.ts,
    value_num = excluded.value_num,
    valid = excluded.valid,
    updated_at = CURRENT_TIMESTAMP
`);

function getOrCreateSensor(gw, node, name, unit = null) {
  const existing = findSensor.get(gw, node, name);
  if (existing) return existing.id;
  return insertSensor.run(gw, node, name, unit, 'number').lastInsertRowid;
}

function saveSensorValue({ gw, node, frameId, timestamp, name, unit, value, valid }) {
  const sensorId = getOrCreateSensor(gw, node, name, unit);
  const numericValue = value == null ? null : Number(value);
  const isValid = valid == null ? 1 : (valid ? 1 : 0);

  insertSensorReading.run(sensorId, frameId, timestamp, numericValue, isValid);
  upsertCurrentReading.run(sensorId, frameId, timestamp, numericValue, isValid);
}

function getPumps(payload) {
  if (Array.isArray(payload.pump)) return payload.pump;
  if (payload.node) {
    return [{
      ...payload.pump,
      node: payload.node,
      addr: payload.addr,
      i: payload.i,
      unbal_pct: payload.i?.unbal_pct,
    }];
  }
  if (payload.pump?.node) return [payload.pump];
  if (payload.pump && typeof payload.pump === 'object') return Object.values(payload.pump);
  return [];
}

const savePayloadTransaction = db.transaction((payload) => {
  upsertGateway.run({
    gw: payload.gw,
    site: payload.site,
    fw: payload.diag?.fw ?? null,
    uid: payload.diag?.uid ?? null,
    ts: payload.ts,
  });

  const frameId = insertFrame.run(
    payload.site,
    payload.gw,
    payload.seq,
    payload.ts,
    payload.diag?.vdda_mv ?? null,
    payload.diag?.rssi ?? null,
    payload.diag?.heap_free ?? null,
    JSON.stringify(payload)
  ).lastInsertRowid;

  for (const pump of getPumps(payload).filter((item) => item?.node)) {
    upsertDevice.run({
      gw: payload.gw,
      node: pump.node,
      site: payload.site,
      addr: pump.addr ?? null,
      state: pump.state ?? 'unknown',
      ts: payload.ts,
    });

    const current = pump.i ?? {};
    const readings = [
      ['current_l1', 'A', current.l1, current.valid],
      ['current_l2', 'A', current.l2, current.valid],
      ['current_l3', 'A', current.l3, current.valid],
      ['current_unbalance', '%', pump.unbal_pct ?? current.unbal_pct, current.valid],
      ['temperature', payload.t?.unit ?? 'C', payload.t?.val, payload.t?.valid],
    ];

    for (const [name, unit, value, valid] of readings) {
      saveSensorValue({
        gw: payload.gw,
        node: pump.node,
        frameId,
        timestamp: payload.ts,
        name,
        unit,
        value,
        valid,
      });
    }
  }
});

function savePayload(payload) {
  savePayloadTransaction(payload);
}

const latestReadingsQuery = `
  SELECT
    d.node AS id,
    d.site,
    d.gw,
    d.state,
    d.last_seen_ts AS timestamp,
    (SELECT cr.value_num FROM current_readings cr JOIN sensors s ON s.id = cr.sensor_id
      WHERE s.gw = d.gw AND s.node = d.node AND s.name = 'current_l1') AS i_l1,
    (SELECT cr.value_num FROM current_readings cr JOIN sensors s ON s.id = cr.sensor_id
      WHERE s.gw = d.gw AND s.node = d.node AND s.name = 'current_l2') AS i_l2,
    (SELECT cr.value_num FROM current_readings cr JOIN sensors s ON s.id = cr.sensor_id
      WHERE s.gw = d.gw AND s.node = d.node AND s.name = 'current_l3') AS i_l3,
    (SELECT cr.value_num FROM current_readings cr JOIN sensors s ON s.id = cr.sensor_id
      WHERE s.gw = d.gw AND s.node = d.node AND s.name = 'current_unbalance') AS unbal_pct,
    (SELECT cr.valid FROM current_readings cr JOIN sensors s ON s.id = cr.sensor_id
      WHERE s.gw = d.gw AND s.node = d.node AND s.name = 'current_l1') AS i_valid,
    (SELECT cr.value_num FROM current_readings cr JOIN sensors s ON s.id = cr.sensor_id
      WHERE s.gw = d.gw AND s.node = d.node AND s.name = 'temperature') AS temperature,
    (SELECT cr.valid FROM current_readings cr JOIN sensors s ON s.id = cr.sensor_id
      WHERE s.gw = d.gw AND s.node = d.node AND s.name = 'temperature') AS temp_valid
  FROM devices d
`;

function getLatestReadings() {
  return db.prepare(`${latestReadingsQuery} ORDER BY d.node ASC`).all();
}

function getGateways() {
  return db.prepare('SELECT gw, site FROM gateways').all();
}

function getGatewayReadings(gw) {
  return db.prepare(`${latestReadingsQuery} WHERE d.gw = ? ORDER BY d.node ASC`).all(gw);
}

function createUser(username, email, password) {
  db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)')
    .run(username, email, password);
  return Promise.resolve();
}

function isUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
  return Promise.resolve(user);
}

function isUsernameExists(username) {
  const user = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  return Promise.resolve(!!user);
}

function updateUserPassword(username, oldPassword, newPassword) {
  const result = db.prepare(
    'UPDATE users SET password = ? WHERE username = ? AND password = ?'
  ).run(newPassword, username, oldPassword);
  return Promise.resolve(result.changes > 0);
}

function updateUsername(oldUsername, newUsername) {
  const result = db.prepare(
    'UPDATE users SET username = ? WHERE username = ?'
  ).run(newUsername, oldUsername);
  return Promise.resolve(result.changes > 0);
}

module.exports = {
  createUser,
  getGatewayReadings,
  getGateways,
  getLatestReadings,
  isUser,
  isUsernameExists,
  savePayload,
  updateUserPassword,
  updateUsername,
};
