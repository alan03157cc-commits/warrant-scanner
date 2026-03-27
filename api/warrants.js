module.exports = async function handler(req, res) {
  const { stock, type } = req.query;
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = `https://www.twse.com.tw/rwd/zh/warrant/TWTAUU?response=json&stockNo=${stock}&type=${type}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.twse.com.tw/',
        'Accept': 'application/json'
      }
    });

    const text = await response.text();
    // 先回傳原始文字，看 TWSE 實際給什麼
    res.status(200).send(`STATUS: ${response.status}\n\n${text.substring(0, 500)}`);
  } catch (err) {
    res.status(500).send('ERROR: ' + err.message);
  }
}
