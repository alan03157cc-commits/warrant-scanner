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

        // 步驟1: 抓所有權證連結
        const linkRegex = /<a[^>]*href="Info\.aspx\?WID=(\d{6})"[^>]*>([^<]+)<\/a>/gi;
        const warrants = [];
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const symbol = match[1];
            let name = match[2].trim().replace(/^\[|\]$/g, ''); // 清理 [ ] 

            // 取連結後的內容片段 (約 600 字元內)
            const start = match.index + match[0].length;
            const chunk = html.slice(start, start + 600);

            // 步驟2: 從片段提取關鍵欄位 (更寬鬆匹配)
            // 剩餘天數：找數字 + 日/天
            const daysMatch = chunk.match(/(\d{1,4})\s*(?:日|天|剩餘)/i) || chunk.match(/\b(\d{1,4})\b/);
            const days = daysMatch ? parseInt(daysMatch[1]) : 0;

            // 價內外：數字 + %? + 價內/價外
            const moneynessMatch = chunk.match(/([\d.]+)%?\s*(價內|價外)/i);
            let moneyness = 0;
            if (moneynessMatch) {
                moneyness = parseFloat(moneynessMatch[1]);
                if (moneynessMatch[2].toLowerCase().includes('價外')) moneyness = -moneyness;
            }

            // 實質槓桿：實質槓桿 + 數字
            const levMatch = chunk.match(/實質\s*槓桿\s*([\d.]+)/i);
            const lev = levMatch ? parseFloat(levMatch[1]) : 0;

            // 估計 bid/ask (頁面通常無分開，用固定 spread 估計)
            const estPrice = 0.5; // 平均估計，可後續改進
            const bid = estPrice * 0.98;
            const ask = estPrice * 1.02;

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
                console.log(`成功解析一筆：${symbol} ${name} | 天數:${days} | 價內外:${moneyness} | 槓桿:${lev}`);
            }
        }

        console.log(`總解析到 ${warrants.length} 筆權證`);

        if (warrants.length === 0) {
            if (html.includes('沒有相關條件商品') || html.includes('無相關')) {
                console.log('元大顯示：無相關權證');
            } else {
                console.log('regex 可能未完全命中，請檢查 console 片段');
            }
        }

        return warrants;
    } catch (err) {
        console.error('抓取失敗:', err.message);
        return [];
    }
}

// filterWarrants 放寬一點門檻（讓更多筆通過測試）
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
                score: Math.round(100 - dlr * 10000)  // 放寬權重
            };
        })
        .filter(w => {
            if (mode === 'short') {
                return w.days >= 20 && w.moneyness >= -30 && w.moneyness <= 10 && parseFloat(w.dlr_percent) <= 0.25;
            } else {
                return w.days >= 40 && w.moneyness >= -40 && w.moneyness <= 10 && parseFloat(w.dlr_percent) <= 0.35;
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

        if (filtered.length === 0 && raw.length > 0) {
            return res.json({
                target: stock,
                mode: mode || 'swing',
                count: 0,
                data: [],
                message: '有權證但不符合過濾條件（可放寬門檻）'
            });
        }

        res.json({
            target: stock,
            mode: mode || 'swing',
            count: filtered.length,
            data: filtered
        });
    } catch (err) {
        console.error('API 錯誤:', err);
        res.status(500).json({ error: '伺服器錯誤，請查看 log' });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`本地伺服器: http://localhost:${PORT}`);
    });
}
