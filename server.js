const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();

// 允許跨域 + 靜態檔案
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

console.log('Server 啟動中...');

// 從元大權證網抓取資料（使用 regex 解析，避免 cheerio 依賴問題）
async function fetchRealTimeWarrants(stockCode) {
    console.log(`正在查詢元大權證：${stockCode}`);
    try {
        const url = `https://www.warrantwin.com.tw/eyuanta/Warrant/Search.aspx?SID=${stockCode.trim()}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Referer': 'https://www.warrantwin.com.tw/eyuanta/',
                'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
            },
            timeout: 15000
        });

        const html = response.data;
        console.log(`頁面取得成功，長度：${html.length}`);

        // regex 嘗試匹配常見權證格式，例如 [代碼] 名稱 成交價 漲跌 ... 天數 價內外% 價差比 實質槓桿 隱波
        const regex = /\[(\d{6})\]\s*([^\s<]+)\s*([\d.-]+|--)[\s\S]*?(\d+)\s*([\d.]+%價內|[\d.]+%價外)[\s\S]*?(\d+\.?\d*)/gi;

        const warrants = [];
        let match;
        while ((match = regex.exec(html)) !== null) {
            const symbol = match[1];
            const name = match[2];
            const days = parseInt(match[4]) || 0;
            let moneynessStr = match[5] || '';
            let moneyness = parseFloat(moneynessStr.replace(/[^0-9.-]/g, '')) || 0;
            if (moneynessStr.includes('價外')) moneyness = -moneyness;
            const lev = parseFloat(match[6]) || 0;

            // 粗估 bid/ask（因為頁面通常不直接顯示買賣價）
            const estPrice = 1.0; // 之後可改進
            const bid = estPrice * 0.985;
            const ask = estPrice * 1.015;

            if (days > 0 && lev > 0) {
                warrants.push({
                    symbol,
                    name,
                    days,
                    moneyness,
                    bid,
                    ask,
                    lev,
                    delta: 0,
                    iv: 0
                });
                console.log(`找到權證：${symbol} ${name} 天數:${days} 槓桿:${lev}`);
            }
        }

        if (warrants.length === 0) {
            console.log('未找到符合的權證資料');
        }

        return warrants;
    } catch (err) {
        console.error('抓取元大資料失敗：', err.message);
        return [];
    }
}

// 過濾邏輯（極短線 / 波段）
function filterWarrants(warrants, mode = 'swing') {
    console.log(`開始過濾，模式：${mode}，原始筆數：${warrants.length}`);

    const passed = warrants
        .filter(w => {
            if (w.days <= 0 || w.lev <= 0) return false;

            const mid = (w.bid + w.ask) / 2 || 1;
            const spread = Math.abs(w.ask - w.bid) / mid;
            const dlr = spread / w.lev;

            if (mode === 'short') {
                return w.days >= 30 && w.moneyness >= -5 && w.moneyness <= 5 && dlr <= 0.0015;
            } else {
                return w.days >= 60 && w.moneyness >= -10 && w.moneyness <= 5 && dlr <= 0.0020;
            }
        })
        .map(w => {
            const mid = (w.bid + w.ask) / 2 || 1;
            const spread = Math.abs(w.ask - w.bid) / mid;
            const dlr = spread / w.lev;
            return {
                ...w,
                dlr_percent: dlr.toFixed(4),
                score: Math.round(100 - dlr * 15000)
            };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    console.log(`過濾完成，結果筆數：${passed.length}`);
    return passed;
}

// API 路由
app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    console.log(`API 請求：stock=${stock}, mode=${mode}`);

    if (!stock) {
        return res.status(400).json({ error: '請提供股票代號，例如 ?stock=2330' });
    }

    try {
        const raw = await fetchRealTimeWarrants(stock);
        const filtered = filterWarrants(raw, mode || 'swing');
        res.json({
            target: stock,
            mode: mode || 'swing',
            count: filtered.length,
            data: filtered
        });
    } catch (err) {
        console.error('API 處理錯誤：', err);
        res.status(500).json({ error: '伺服器錯誤，請稍後再試' });
    }
});

// Vercel 需要 export app
module.exports = app;

// 本地開發時啟動伺服器
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`本地伺服器運行於 http://localhost:${PORT}`);
        console.log('測試連結：');
        console.log(`  http://localhost:${PORT}/api/warrants?stock=2330`);
        console.log(`  http://localhost:${PORT}/api/warrants?stock=2330&mode=short`);
    });
}
