export default async function handler(req, res) {
  const { stock, type } = req.query;
  
  try {
    const url = `https://www.twse.com.tw/rwd/zh/warrant/TWTAUU?response=json&stockNo=${stock}&type=${type}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.twse.com.tw/',
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
