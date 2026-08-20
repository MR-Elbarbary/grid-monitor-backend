const express = require('express');
const { createUser, isUser, isHashExists, isHashHasUser, isUsernameExists } = require('./utils/database');
const app = express();
const PORT = 5000;
  
app.use(express.json());

// Main endpoint to fetch system readings
app.get('/api/readings', (req, res) => {
  // Generate a random total of units (between 3 and 7 cards)
  const unitCount = Math.floor(Math.random() * 5) + 3;
  
  const unitsData = Array.from({ length: unitCount }, (_, index) => {
    const unitId = index + 1;
    return {
      id: `UNIT-${1000 + unitId}`,
      name: `Power Core Unit #${unitId}`,
      metrics: {
        current: parseFloat((Math.random() * 15 + 2).toFixed(2)),     // 2A - 17A
        voltage: parseFloat((Math.random() * 20 + 210).toFixed(1)),   // 210V - 230V
        temperature: parseFloat((Math.random() * 40 + 30).toFixed(1)) // 30°C - 70°C
      },
      timestamp: new Date().toISOString()
    };
  });

  // Return the data as a clean JSON wrapper payload
  res.json({
    success: true,
    total_units: unitCount,
    data: unitsData
  });
});

app.post('/api/createUser', async (req, res) => {
  const { username, password, hash } = req.body;
  
  if (!username || !password || !hash) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    if (!(await isHashExists(hash))) {
      return res.status(400).json({ success: false, message: 'Invalid hash provided' });
    }

    if (await isHashHasUser(hash)) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    if (await isUsernameExists(username)) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    createUser(username, password, hash)
      .then(() => res.json({ success: true, message: 'User created successfully' }))
      .catch((error) => res.status(500).json({ success: false, message: error.message }));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/validateUser', (req, res) => {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`the server is running`);
});
