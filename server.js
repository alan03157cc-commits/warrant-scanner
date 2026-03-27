const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// TWSE 代理引擎：支援輸入任何代號
app.get('/api/warrants', async (req, res) => {
    const { stock, type } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少標的代號' });

    // 決定 TWSE API 路徑 (認購 C: TWTAUU, 認售 P: TWTBUU)
    const apiPath = type === 'P' ? 'TWTBUU' : 'TWTAUU';
    const apiUrl = `https://www.twse.com.tw/rwd/zh/warrant/${apiPath}?response=json&stockNo=${stock}`;

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.twse.com.tw/zh/page/warrant/TWTAUU.html'
            },
            timeout: 10000 // 10秒超時
        });

        // 直接轉發原始資料 (讓前端解析)
        res.json(response.data);
    } catch (error) {
        console.error('TWSE Proxy Error:', error.message);
        res.status(500).json({ error: `連線交易所失敗: ${error.message}` });
    }
});

// Vercel 專屬輸出
module.exports = app;

// 本機開發啟動 (僅在直接執行時)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ 伺服器已啟動: http://localhost:${PORT}`);
    });
}