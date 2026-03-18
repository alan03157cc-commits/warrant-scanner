const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

console.log('Server 啟動中...');

async function fetchRealTimeWarrants(stockCode) {
    console.log(`正在查詢元大權證：${stockCode}`);
    try {
        const url = `https://www.warrantwin.com.tw/eyuanta/Warrant/Search.aspx?SID=${stockCode.trim()}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Referer': 'https://www.warrantwin.com.tw/eyuanta/'
            },
            timeout: 15000
        });

        const html = response.data;
        console.log(`頁面取得成功，長度：${html.length}`);

        // 優化 regex：先抓 [代碼] 連結文字，然後附近數字/文字
        const linkRegex = /<a[^>]*href="Info\.aspx\?WID=(\d{6})"[^>]*>([^<]+)<\/a>/gi;
        const warrants = [];
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const symbol = match[1];
            let name = match[2].trim();

            // 找後續內容（後面幾個 exec 位置的文字）
            const start = match.index + match[0].length;
            const nextChunk = html.slice(start, start + 500); // 取後 500 字元
            console.log(`找到代碼 ${symbol}，後續文字片段：${nextChunk.substring(0, 100)}...`);

            // 從片段提取天數 (純數字，近似剩餘日)
            const daysMatch = nextChunk.match(/(\d{1,3})\s*(?:日|天)/) || nextChunk.match(/\b(\d{1,3})\b/);
            const days = daysMatch ? parseInt(daysMatch[1]) : 0;

            // 價內外 (數字 + 價內/價外)
            const moneynessMatch = nextChunk.match(/([\d.]+)%?(價內|價外)/);
            let moneyness = 0;
            if (moneynessMatch) {
                moneyness = parseFloat(moneynessMatch[1]);
                if (moneynessMatch[2] === '價外') moneyness = -moneyness;
            }

            // 實質槓桿 (實質槓桿 X.XX)
            const levMatch = nextChunk.match(/實質槓桿\s*([\d.]+)/);
            const lev = levMatch ? parseFloat(levMatch[1]) : 0;

            // 估計 bid/ask
            const bid = 1.0 * 0.985;
            const ask = 1.0 * 1.015;

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
                console.log(`成功解析：${symbol} ${name} 天數:${days} 價內外:${moneyness} 槓桿:${lev}`);
            }
        }

        if (warrants.length === 0) {
            if (html.includes('沒有相關條件商品') || html.includes('無相關')) {
                console.log('元大顯示無相關權證');
            } else {
                console.log('regex 未命中任何權證，請檢查頁面');
            }
        }

        return warrants;
    } catch (err) {
        console.error('抓取失敗:', err.message);
        return [];
    }
}

function filterWarrants(warrants, mode = 'swing') {
    console.log(`過濾模式: ${mode}, 原始筆數: ${warrants.length}`);
    const passed = warrants
        .filter(w => w.days > 0 && w.lev > 0)
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
        .filter(w => {
            if (mode === 'short') {
                return w.days >= 30 && w.moneyness >= -5 && w.moneyness <= 5 && parseFloat(w.dlr_percent) <= 0.15;
            } else {
                return w.days >= 60 && w.moneyness >= -10 && w.moneyness <= 5 && parseFloat(w.dlr_percent) <= 0.20;
            }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    console.log(`過濾後筆數: ${passed.length}`);
    return passed;
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    console.log(`API 請求: stock=${stock}, mode=${mode || 'swing'}`);

    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

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
        console.error('API 錯誤:', err);
        res.status(500).json({ error: '伺服器錯誤' });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`本地伺服器: http://localhost:${PORT}`);
    });
}
