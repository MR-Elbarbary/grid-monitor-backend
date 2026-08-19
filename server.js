const express = require('express');
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`the server is running`);
});
