const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

console.log('Server 啟動中...');

async function fetchRealTimeWarrants(stockCode) {
    console.log(`查詢元大權證：${stockCode}`);
    try {
        const url = `https://www.warrantwin.com.tw/eyuanta/Warrant/Search.aspx?SID=${stockCode.trim()}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Referer': 'https://www.warrantwin.com.tw/eyuanta/'
            },
            timeout: 20000
        });

        const html = response.data;
        console.log(`頁面長度：${html.length}`);

        // 如果解析失敗，就用 dummy 資料（讓你看到列表）
        console.log('解析失敗 → 使用 dummy 資料');
        return [
            {
                symbol: '030205',
                name: '台積電元大53購03 (解析失敗)',
                days: 13,
                moneyness: 43.14,
                bid: 6.85,
                ask: 6.90,
                lev: 3.17,
                delta: 0.5,
                iv: 0,
                dlr_percent: '0.15%',
                score: 85
            },
            {
                symbol: '030362',
                name: '台積電元大54購19 (解析失敗)',
                days: 20,
                moneyness: 42.61,
                bid: 4.99,
                ask: 5.05,
                lev: 3.39,
                delta: 0.6,
                iv: 0,
                dlr_percent: '0.12%',
                score: 88
            },
            {
                symbol: '030632',
                name: '台積電元大54購20 (解析失敗)',
                days: 20,
                moneyness: 11.29,
                bid: 4.99,
                ask: 5.05,
                lev: 8.83,
                delta: 0.7,
                iv: 0,
                dlr_percent: '0.10%',
                score: 90
            }
        ];
    } catch (err) {
        console.error('抓取失敗：', err.message);
        return [];
    }
}

function filterWarrants(warrants, mode = 'swing') {
    console.log(`過濾模式：${mode}，原始筆數：${warrants.length}`);
    return warrants; // 臨時版直接全部回傳
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

    try {
        const raw = await fetchRealTimeWarrants(stock);
        const filtered = filterWarrants(raw, mode || 'swing');
        res.json({
            target: stock,
            mode: mode || 'swing',
            count: filtered.length,
            data: filtered,
            note: '這是臨時 dummy 資料（解析失敗），之後會換群益版'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`本地跑在 http://localhost:${PORT}`));
}
