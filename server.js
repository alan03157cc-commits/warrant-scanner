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
        console.log(`頁面長度：${html.length}，開始解析...`);

        // 步驟1: 抓所有權證連結
        const linkRegex = /<a[^>]*href="Info\.aspx\?WID=(\d{6})"[^>]*>([^<]+)<\/a>/gi;
        const warrants = [];
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const symbol = match[1];
            let name = match[2].trim();

            // 取後續片段（連結後約 800 字元）
            const start = match.index + match[0].length;
            const chunk = html.slice(start, start + 800).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

            console.log(`找到 ${symbol} ${name}，後續片段：${chunk.substring(0, 150)}...`);

            // 提取剩餘天數（找數字 + 日/天/剩餘）
            const daysMatch = chunk.match(/(\d{1,4})\s*(?:日|天|剩餘)/i) || chunk.match(/\b(\d{1,4})\b/);
            const days = daysMatch ? parseInt(daysMatch[1]) : 0;

            // 價內外（數字 + %? + 價內/價外）
            const moneynessMatch = chunk.match(/([\d.]+)%?\s*(價內|價外)/i);
            let moneyness = 0;
            if (moneynessMatch) {
                moneyness = parseFloat(moneynessMatch[1]);
                if (moneynessMatch[2].toLowerCase().includes('價外')) moneyness = -moneyness;
            }

            // 實質槓桿（實質槓桿 + 數字）
            const levMatch = chunk.match(/實質\s*槓桿\s*([\d.]+)/i) || chunk.match(/槓桿\s*([\d.]+)/i);
            const lev = levMatch ? parseFloat(levMatch[1]) : 0;

            // 估計 bid/ask（用固定值測試，之後可改）
            const bid = 1.0;
            const ask = 1.05;

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
                console.log(`解析成功：${symbol} | 天數:${days} | 價內外:${moneyness} | 槓桿:${lev}`);
            }
        }

        console.log(`總共解析到 ${warrants.length} 筆權證`);

        return warrants;
    } catch (err) {
        console.error('抓取失敗：', err.message);
        return [];
    }
}

function filterWarrants(warrants, mode = 'swing') {
    console.log(`過濾：模式 ${mode}，原始 ${warrants.length} 筆`);

    const passed = warrants
        .filter(w => w.days > 0 && w.lev > 0)
        .map(w => {
            const mid = (w.bid + w.ask) / 2 || 1;
            const spread = Math.abs(w.ask - w.bid) / mid;
            const dlr = spread / w.lev;
            return {
                ...w,
                dlr_percent: dlr.toFixed(4),
                score: Math.round(100 - dlr * 10000)
            };
        })
        .filter(w => {
            if (mode === 'short') {
                return w.days >= 10 && w.moneyness >= -50 && w.moneyness <= 50 && parseFloat(w.dlr_percent) <= 0.5; // 測試放寬
            } else {
                return w.days >= 30 && w.moneyness >= -50 && w.moneyness <= 50 && parseFloat(w.dlr_percent) <= 0.5;
            }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    console.log(`過濾後：${passed.length} 筆`);
    return passed;
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
            debug: raw.length > 0 ? '有原始資料但過濾沒通過' : '無原始資料（元大可能無此權證或解析失敗）'
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
