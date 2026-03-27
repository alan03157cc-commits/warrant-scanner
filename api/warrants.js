const https = require('https');

module.exports = async function handler(req, res) {
  const { stock, type } = req.query;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const url = `https://www.twse.com.tw/rwd/zh/warrant/TWTAUU?response=json&stockNo=${stock}&type=${type}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.twse.com.tw/',
        'Accept': 'application/json, text/plain, */*'
      }
    });
    
    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
