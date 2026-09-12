const express = require('express');

const mqtt = require('mqtt');
const {
  createUser,
  getGatewayReadings,
  getGateways,
  getLatestReadings,
  isUser,
  isUsernameExists,
  savePayload,
  updateUserPassword,
  updateUsername,
} = require('./utils/database');
const app = express();
const PORT = 5000;
  
app.use(express.json());


const MQTT_BROKER = 'mqtts://d150953c35494136ae381dbb9da9377d.s1.eu.hivemq.cloud:8883';
const TOPIC_TELEMETRY = 'pumpmon/#';
const MQTT_USERNAME = 'homedeb';
const MQTT_PASSWORD = 'Q2e4t6u8o0';

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: 'express_backend_' + Math.random().toString(16).substring(2, 8),
  clean: true,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  rejectUnauthorized: false,
});


mqttClient.on('connect', () => {
  console.log('Connected to MQTT Broker');
  mqttClient.subscribe(TOPIC_TELEMETRY, { qos: 0 }, (err) => {
    if (!err) console.log(`Subscribed to MQTT Topic: ${TOPIC_TELEMETRY}`);
  });
});


mqttClient.on('message', (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      savePayload(payload);
      console.log(`[MQTT RECEIVED & SAVED] GW: ${payload.gw} | Seq: ${payload.seq}`);
    } catch (err) {
      console.error('Error processing MQTT message:', err.message);
    }
});

app.get('/api/readings', (req, res) => {
  console.log('received');

  try {
    // Query latest telemetry reading for each unique device node
    const latestReadings = getLatestReadings();

    // remove the gw from the name

    // Map database rows into formatted JSON units output
    const unitsData = latestReadings.map((row) => ({
      id: row.id,
      name: `Pump ${row.id} (${row.gw})`,
      state: row.state,
      metrics: {
        i_l1: row.i_l1,
        i_l2: row.i_l2,
        i_l3: row.i_l3,
        i_valid: row.i_valid,
        unbalance_percentage: row.unbal_pct,
        temperature: row.temperature,
        temperature_valid: row.temp_valid
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

app.get('/api/gw', (req, res) => {
  try {
    const gateways = getGateways();
    res.json({ success: true, data: gateways });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch gateways' });
  }
});


// test this one
app.get('/api/gw_readings/:gw', (req, res) => {
  const { gw } = req.params;
  try {
    const latestReadings = getGatewayReadings(gw);

    const unitsData = latestReadings.map((row) => ({
      id: row.id,
      name: `Pump ${row.id} (${row.gw})`,
      state: row.state,
      metrics: {
        i_l1: row.i_l1,
        i_l2: row.i_l2,
        i_l3: row.i_l3,
        unbalance_percentage: row.unbal_pct,
        temperature: row.temperature,
        temperature_valid: row.temp_valid,
        i_valid: row.i_valid,
      },
      timestamp: new Date(row.timestamp * 1000).toISOString(),
    }));

    res.json({
      success: true,
      total_units: unitsData.length,
      data: unitsData,
    });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch gateway readings' });
  }
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`the server is running`);
});
