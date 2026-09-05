const express = require('express');

const mqtt = require('mqtt');
const initializeDatabase = require('./db_init.js');

const db = initializeDatabase();

const { createUser, isUser, isUsernameExists, updateUserPassword, updateUsername } = require('./utils/database');
const app = express();
const PORT = 5000;
  
app.use(express.json());


const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const TOPIC_TELEMETRY = 'site/alex/telemetry';

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: 'express_backend_' + Math.random().toString(16).substring(2, 8),
  clean: true,
});


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
  INSERT INTO telemetry_frames (site, gw, seq, ts, temp_val, temp_unit, temp_valid, vdda_mv, rssi, heap_free, raw_payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertReading = db.prepare(`
  INSERT INTO device_readings (frame_id, gw, node, state, i_l1, i_l2, i_l3, i_valid, unbal_pct, uptime_s, starts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);



// Atomic Transaction to Save Data
const savePayloadTransaction = db.transaction((payload) => {
  upsertGateway.run({
    gw: payload.gw,
    site: payload.site,
    fw: payload.diag?.fw ?? null,
    uid: payload.diag?.uid ?? null,
    ts: payload.ts,
  });

  const frameRes = insertFrame.run(
    payload.site,
    payload.gw,
    payload.seq,
    payload.ts,
    payload.t?.val ?? null,
    payload.t?.unit ?? 'C',
    payload.t?.valid ? 1 : 0,
    payload.diag?.vdda_mv ?? null,
    payload.diag?.rssi ?? null,
    payload.diag?.heap_free ?? null,
    JSON.stringify(payload)
  );

  const frameId = frameRes.lastInsertRowid;

  if (Array.isArray(payload.pump)) {
    for (const p of payload.pump) {
      upsertDevice.run({
        gw: payload.gw,
        node: p.node,
        site: payload.site,
        addr: p.addr ?? null,
        state: p.state ?? 'unknown',
        ts: payload.ts,
      });

      insertReading.run(
        frameId,
        payload.gw,
        p.node,
        p.state ?? 'unknown',
        p.i?.l1 ?? null,
        p.i?.l2 ?? null,
        p.i?.l3 ?? null,
        p.i?.valid ? 1 : 0,
        p.unbal_pct ?? null,
        p.uptime_s ?? null,
        p.starts ?? null
      );
    }
  }
});


// MQTT Connection Callbacks
mqttClient.on('connect', () => {
  console.log('Connected to MQTT Broker');
  mqttClient.subscribe(TOPIC_TELEMETRY, (err) => {
    if (!err) console.log(`Subscribed to MQTT Topic: ${TOPIC_TELEMETRY}`);
  });
});

// Handle incoming telemetry payload
mqttClient.on('message', (topic, message) => {
  if (topic === TOPIC_TELEMETRY) {
    try {
      const payload = JSON.parse(message.toString());
      savePayloadTransaction(payload);
      console.log(`[MQTT RECEIVED & SAVED] GW: ${payload.gw} | Seq: ${payload.seq}`);
    } catch (err) {
      console.error('Error processing MQTT message:', err.message);
    }
  }
});

// -------------------------------------------------------------
// 2. Updated API Route Reading from Database
// -------------------------------------------------------------
app.get('/api/readings', (req, res) => {
  console.log('received');

  try {
    // Query latest telemetry reading for each unique device node
    const latestReadings = db.prepare(`
      SELECT 
        dr.node AS id,
        d.site,
        dr.gw,
        dr.state,
        dr.i_l1,
        dr.i_l2,
        dr.i_l3,
        dr.unbal_pct,
        tf.temp_val AS temperature,
        tf.ts AS timestamp
      FROM device_readings dr
      JOIN devices d ON dr.gw = d.gw AND dr.node = d.node
      JOIN telemetry_frames tf ON dr.frame_id = tf.id
      WHERE dr.id IN (
        SELECT MAX(id) FROM device_readings GROUP BY gw, node
      )
      ORDER BY dr.node ASC
    `).all();

    // Map database rows into formatted JSON units output
    const unitsData = latestReadings.map((row) => ({
      id: row.id,
      name: `Pump ${row.id} (${row.gw})`,
      state: row.state,
      metrics: {
        i_l1: row.i_l1,
        i_l2: row.i_l2,
        i_l3: row.i_l3,
        unbalance_percentage: row.unbal_pct,
        temperature: row.temperature
      },
      timestamp: new Date(row.timestamp * 1000).toISOString()
    }));

    res.json({
      success: true,
      total_units: unitsData.length,
      data: unitsData
    });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch readings' });
  }
});

app.post('/api/createUser', async (req, res) => {
  console.log('received')
  const { username, email, password, hash } = req.body;
  
  if (!username || !email || !password || !hash) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {

    if (await isUsernameExists(username)) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    createUser(username, email, password, hash)
      .then(() => res.json({ success: true, message: 'User created successfully' }))
      .catch((error) => res.status(500).json({ success: false, message: error.message }));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/validateUser', (req, res) => {
  console.log('received')
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  isUser(username, password)
    .then((user) => {
      if (user) {
        res.json({ success: true, message: 'User validated successfully', hash: user.hash });
      } else {
        res.status(401).json({ success: false, message: 'Invalid username or password' });
      }
    })
    .catch((error) => res.status(500).json({ success: false, message: error.message }));
});

app.post('api/changePassword', (req, res) => {
  console.log('received')
  const { username, oldPassword, newPassword } = req.body;

  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  isUser(username, oldPassword)
    .then((user) => {
      if (user) {
        updateUserPassword(username, oldPassword, newPassword)
          .then(() => res.json({ success: true, message: 'Password changed successfully' }))
          .catch((error) => res.status(500).json({ success: false, message: error.message }));
      } else {
        res.status(401).json({ success: false, message: 'Invalid username or old password' });
      }
    })
    .catch((error) => res.status(500).json({ success: false, message: error.message }));
});

app.post('/api/changeUsername', (req, res) => {
  console.log('received')
  const { oldUsername, newUsername, password } = req.body;

  if (!oldUsername || !newUsername || !password) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  isUser(oldUsername, password)
    .then(async (user) => {
      if (user) {
        if (await isUsernameExists(newUsername)) {
          return res.status(400).json({ success: false, message: 'New username already exists' });
        }
        updateUsername(oldUsername, newUsername)
          .then(() => res.json({ success: true, message: 'Username changed successfully' }))
          .catch((error) => res.status(500).json({ success: false, message: error.message }));
      } else {
        res.status(401).json({ success: false, message: 'Invalid old username or password' });
      }
    })
    .catch((error) => res.status(500).json({ success: false, message: error.message }));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`the server is running`);
});
