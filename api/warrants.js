const https = require('https');

function fetchUrl(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-TW,zh;q=0.9'
      }
    };

    https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${url.hostname}${res.headers.location}`;
        return resolve(fetchUrl(next, redirectCount + 1));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject).end();
  });
}

module.exports = async function handler(req, res) {
  const { stock, type } = req.query;
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const url = `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap67_O?l=zh-tw&se=EW&s=${stock}`;
    const data = await fetchUrl(url);
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
```

推上去後再打：
```
https://warrant-scanner.vercel.app/api/warrants?stock=2330
