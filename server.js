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
    if (!stock) return res.status(400).json({ error: '缺少標標代號' });

    // 決定 TWSE API 路徑 (認購 C: TWTAUU, 認售 P: TWTBUU)
    const apiPath = type === 'P' ? 'TWTBUU' : 'TWTAUU';
    
    // 使用核心 API 端點，減少 RWD 層次的阻擋
    const apiUrl = `https://www.twse.com.tw/exchangeReport/${apiPath}?response=json&stockNo=${stock}`;

    try {
        console.log(`[Proxy] Fetching ${stock} (${type})...`);
        const response = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `https://www.twse.com.tw/zh/page/warrant/${apiPath}.html`
            },
            timeout: 8000
        });

        // 檢查證交所回傳狀態碼
        if (response.data && response.data.stat !== 'OK' && response.data.stat !== '查詢日期無資料') {
            console.warn(`[TWSE] ${stock} Warning: ${response.data.stat}`);
        }

        res.json(response.data);
    } catch (error) {
        const status = error.response ? error.response.status : 'ERR';
        console.error(`[TWSE Error] HTTP ${status}:`, error.message);
        res.status(500).json({ 
            error: `交易所連線失敗: ${error.message} (HTTP ${status})`,
            details: error.response ? error.response.data : null
        });
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