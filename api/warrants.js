const https = require('https');

module.exports = function handler(req, res) {
  const { stock, type } = req.query;
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 使用證交所開放資料 OpenAPI
  const path = `/v1/exchangeReport/TWTAUU?stockNo=${stock}&type=${type || 'C'}`;

  const options = {
    hostname: 'openapi.twse.com.tw',
    path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0',
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
