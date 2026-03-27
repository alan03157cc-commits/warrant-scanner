const https = require('https');

module.exports = function handler(req, res) {
  const { stock, type } = req.query;
  res.setHeader('Access-Control-Allow-Origin', '*');

  const options = {
    hostname: 'www.twse.com.tw',
    path: `/rwd/zh/warrant/TWTAUU?response=json&stockNo=${stock}&type=${type}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.twse.com.tw/',
      'Accept': 'application/json'
    }
  };

  const request = https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(data);
    });
  });

  request.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });

  request.end();
};
