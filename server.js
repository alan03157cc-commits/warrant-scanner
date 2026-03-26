const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

async function fetchTWSE(stockNo, type) {
  const res = await axios.get('https://www.twse.com.tw/rwd/zh/warrant/TWTAUU', {
    params: { response: 'json', stockNo, type },
    headers: HEADERS,
    timeout: 12000
  });
  const rows = res.data?.data || [];
  return rows.map(row => ({
    symbol:    row[0],
    name:      row[1],
    type,
    strike:    parseFloat(row[2]?.replace(/,/g,'')) || 0,
    expire:    row[3],
    days:      parseInt(row[4]) || 0,
    bid:       parseFloat(row[7]?.replace(/,/g,'')) || 0,
    ask:       parseFloat(row[8]?.replace(/,/g,'')) || 0,
    price:     parseFloat(row[9]?.replace(/,/g,'')) || 0,
    moneyness: parseFloat(row[15]) || 0,
    delta:     parseFloat(row[16]) || 0,
    iv:        parseFloat(row[17]) || 0,
    lev:       parseFloat(row[18]) || 0,
  }));
}

function filterWarrants(warrants, mode) {
  const minDays = mode === 'short' ? 10 : 20;
  return warrants
    .filter(w => w.days >= minDays && w.lev > 0 && Math.abs(w.moneyness) <= 50)
    .map(w => {
      const mid = (w.bid > 0 && w.ask > 0) ? (w.bid + w.ask) / 2 : (w.price || 1);
      const spread = (w.bid > 0 && w.ask > 0) ? Math.abs(w.ask - w.bid) / mid : 0.5;
      const dlr = spread / w.lev;
      return { ...w, dlr_pct: (dlr * 100).toFixed(3), score: Math.max(0, Math.round(100 - dlr * 10000)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

app.get('/api/warrants', async (req, res) => {
  const { stock, mode } = req.query;
  if (!stock) return res.status(400).json({ error: '請輸入股票代號' });
  try {
    const [callData, putData] = await Promise.all([
      fetchTWSE(stock, 'C'),
      fetchTWSE(stock, 'P')
    ]);
    const raw = [...callData, ...putData];
    const filtered = filterWarrants(raw, mode || 'swing');
    res.json({ target: stock, mode: mode || 'swing', rawCount: raw.length, count: filtered.length, data: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
}
