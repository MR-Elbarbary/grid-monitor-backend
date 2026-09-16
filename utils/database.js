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
  INSERT INTO devices (gw, node, site, addr, state, alerts_json, last_seen_ts)
  VALUES (@gw, @node, @site, @addr, @state, @alertsJson, @ts)
  ON CONFLICT(gw, node) DO UPDATE SET
    site = excluded.site,
    addr = excluded.addr,
    state = excluded.state,
    alerts_json = excluded.alerts_json,
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
  if (payload.node) {
    return [{
      ...payload.pump,
      node: payload.node,
      addr: payload.addr,
      i: payload.i,
      unbal_pct: payload.i?.unbal_pct,
    }];
  }
  if (Array.isArray(payload.pump)) return payload.pump;
  if (payload.pump?.node) return [payload.pump];
  if (payload.pump && typeof payload.pump === 'object') return Object.values(payload.pump);
  return [];
}

const FAULT_DEFINITIONS = {
  TEMP_SENSOR_LOST: { severity: 'critical', title: 'Temperature sensor lost', action: 'Plug the sensor jack into the board or replace the temperature probe.' },
  CT_DISCONNECTED: { severity: 'critical', title: 'Current transformer disconnected', action: 'Check the named CT jack, wiring, and plug seating.' },
  PHASE_LOSS: { severity: 'critical', title: 'Phase loss', action: 'Inspect motor connections and the contactor.' },
  LOCKED_ROTOR: { severity: 'critical', title: 'Locked rotor', action: 'Check the motor for jamming or severe overload.' },
  OVERCURRENT: { severity: 'critical', title: 'Overcurrent', action: 'Check the pump load and operating conditions.' },
  OVERTEMP: { severity: 'critical', title: 'Overtemperature', action: "Check the motor's cooling system and operating load." },
  UNBALANCE: { severity: 'warning', title: 'Phase unbalance', action: "Inspect for degrading connections or winding faults against the pump's baseline." },
  BIAS_FAULT: { severity: 'critical', title: 'Current sensor bias fault', action: 'Repair or replace the node board.' },
  CT_SATURATION: { severity: 'warning', title: 'CT saturation', action: 'Replace the transducer with a compliant CT.' },
  COMMS_LOST: { severity: 'critical', title: 'Communications lost', action: 'Check gateway power, bus wiring, and site internet.' },
  BAD_ADDRESS: { severity: 'critical', title: 'Invalid node address', action: 'Inspect the resistor straps on the node PCB.' },
  BUTTON_STUCK: { severity: 'warning', title: 'ACK button stuck', action: 'Inspect the node front-panel button.' },
  RTC_BATTERY: { severity: 'warning', title: 'RTC battery fault', action: 'Replace the CR2032 battery.' },
  EEPROM_FAULT: { severity: 'critical', title: 'EEPROM fault', action: 'Re-commit configuration or replace the EEPROM.' },
  NOT_COMMISSIONED: { severity: 'warning', title: 'Node not commissioned', action: "Set the pump's Full Load Amps in the gateway portal." },
};

function deriveFaults(payload, pump) {
  const diagnostic = payload.diag ?? {};
  const current = pump.i ?? {};
  const temperature = payload.t ?? {};
  const derived = [];
  const add = (code, detail = {}) => derived.push({ code, detail });
  const timestamp = Number(payload.ts);
  const ageSeconds = Number.isFinite(timestamp) && timestamp > 0
    ? Math.floor(Date.now() / 1000) - timestamp
    : null;

  if (ageSeconds !== null && ageSeconds > 15) {
    add('COMMS_LOST', { ageSeconds, thresholdSeconds: 15 });
  }

  if (diagnostic.conn?.temp === false || temperature.valid === false) {
    add('TEMP_SENSOR_LOST', {
      connectorFitted: diagnostic.conn?.temp,
      temperatureValid: temperature.valid,
    });
  }

  for (const channel of ['ct1', 'ct2', 'ct3']) {
    const phase = channel.slice(-1);
    const currentValue = Number(current[`l${phase}`]);
    if (diagnostic.conn?.[channel] === false
      && current.valid !== false
      && Number.isFinite(currentValue)
      && currentValue === 0) {
      add('CT_DISCONNECTED', { connector: channel, current: currentValue });
    }
  }

  if (current.valid !== false) {
    const phases = [current.l1, current.l2, current.l3].map(Number);
    const average = phases.reduce((sum, value) => sum + value, 0) / phases.length;
    if (phases.every(Number.isFinite) && average > 0 && Math.min(...phases) <= average * 0.2) {
      add('PHASE_LOSS', { l1: current.l1, l2: current.l2, l3: current.l3 });
    }
  }

  if (Array.isArray(diagnostic.dc)
    && diagnostic.dc.length === 3
    && diagnostic.dc.every((value) => Number.isFinite(Number(value))
      && (Number(value) < 2010 || Number(value) > 2090))) {
    add('BIAS_FAULT', { dc: diagnostic.dc });
  }

  return derived;
}

function normalizeFaults(payload, pump) {
  const firmwareFaults = [
    ...(Array.isArray(payload.faults) ? payload.faults.map((code) => ({ code })) : []),
    ...(Array.isArray(pump.faults) ? pump.faults.map((code) => ({ code })) : []),
  ];
  const detectedFaults = [...firmwareFaults, ...deriveFaults(payload, pump)];
  const uniqueFaults = new Map();

  for (const fault of detectedFaults) {
    if (typeof fault.code === 'string' && !uniqueFaults.has(fault.code)) {
      uniqueFaults.set(fault.code, fault);
    }
  }

  return [...uniqueFaults.values()].map(({ code, detail = {} }) => {
      const definition = FAULT_DEFINITIONS[code] ?? {
        severity: 'critical',
        title: code.replaceAll('_', ' ').toLowerCase(),
        action: 'Inspect the node and gateway diagnostics.',
      };
      return {
        code,
        severity: definition.severity,
        title: definition.title,
        action: definition.action,
        gateway: payload.gw,
        node: pump.node,
        active: true,
        timestamp: new Date(payload.ts * 1000).toISOString(),
        detail,
      };
    });
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
      alertsJson: JSON.stringify(normalizeFaults(payload, pump)),
      ts: payload.ts,
    });

    const current = pump.i ?? {};
    const readings = [
      ['current_l1', 'A', current.valid === false ? null : current.l1, current.valid],
      ['current_l2', 'A', current.valid === false ? null : current.l2, current.valid],
      ['current_l3', 'A', current.valid === false ? null : current.l3, current.valid],
      ['current_unbalance', '%', current.valid === false ? null : (pump.unbal_pct ?? current.unbal_pct), current.valid],
      ['temperature', 'C', payload.t?.val, payload.t?.valid],
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
      WHERE s.gw = d.gw AND s.node = d.node AND s.name = 'temperature') AS temp_valid,
    d.alerts_json
  FROM devices d
`;

function parseAlerts(row) {
  try {
    return JSON.parse(row.alerts_json || '[]');
  } catch {
    return [];
  }
}

function getLatestReadings() {
  return db.prepare(`${latestReadingsQuery} ORDER BY d.node ASC`).all();
}

function getGateways() {
  return db.prepare('SELECT gw, site FROM gateways').all();
}

function getGatewayReadings(gw) {
  return db.prepare(`${latestReadingsQuery} WHERE d.gw = ? ORDER BY d.node ASC`).all(gw);
}

function getActiveAlerts(gw = null) {
  const rows = gw
    ? db.prepare('SELECT alerts_json FROM devices WHERE gw = ?').all(gw)
    : db.prepare('SELECT alerts_json FROM devices').all();
  return rows.flatMap(parseAlerts);
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
  getActiveAlerts,
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
