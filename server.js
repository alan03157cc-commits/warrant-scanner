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

        // 步驟1: 切割成行級別（找 <tr> 內容）
        const rowMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        const warrants = [];

        for (const row of rowMatches) {
            // 找連結
            const linkMatch = row.match(/href="Info\.aspx\?WID=(\d{6})"[^>]*>([^<]+)<\/a>/i);
            if (!linkMatch) continue;

            const symbol = linkMatch[1];
            let name = linkMatch[2].trim();

            // 清理 name
            name = name.replace(/^\[|\]$/g, '').trim();

            // 從整行文字提取關鍵欄位（移除標籤後）
            const cleanRow = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

            // 剩餘天數：找靠近 "剩餘" 或純數字
            const daysMatch = cleanRow.match(/(\d{1,4})\s*(?:剩餘|日|天)/i) || cleanRow.match(/\b(\d{1,4})\b/);
            const days = daysMatch ? parseInt(daysMatch[1]) : 0;

            // 價內外：數字 + 價內/價外
            const moneynessMatch = cleanRow.match(/([\d.]+)\s*(價內|價外)/i);
            let moneyness = 0;
            if (moneynessMatch) {
                moneyness = parseFloat(moneynessMatch[1]);
                if (moneynessMatch[2].includes('價外')) moneyness = -moneyness;
            }

            // 實質槓桿：實質槓桿 + 數字
            const levMatch = cleanRow.match(/實質\s*槓桿\s*([\d.]+)/i) || cleanRow.match(/槓桿\s*([\d.]+)/i);
            const lev = levMatch ? parseFloat(levMatch[1]) : 0;

            // 估計價格（測試用）
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
                console.log(`成功抓到：${symbol} ${name} | 天數:${days} | 價內外:${moneyness} | 槓桿:${lev}`);
            }
        }

        console.log(`總共抓到 ${warrants.length} 筆權證`);

        return warrants;
    } catch (err) {
        console.error('抓取失敗：', err.message);
        return [];
    }
}

function filterWarrants(warrants, mode = 'swing') {
    console.log(`過濾模式：${mode}，原始筆數：${warrants.length}`);

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
            // 測試放寬，讓 2330 至少顯示一些
            if (mode === 'short') {
                return w.days >= 10 && w.moneyness >= -100 && w.moneyness <= 100 && parseFloat(w.dlr_percent) <= 1.0;
            } else {
                return w.days >= 20 && w.moneyness >= -100 && w.moneyness <= 100 && parseFloat(w.dlr_percent) <= 1.0;
            }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    console.log(`過濾後筆數：${passed.length}`);
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
            debugInfo: {
                rawCount: raw.length,
                message: raw.length > 0 ? '有原始資料，但過濾沒通過' : '無原始資料（解析失敗或元大無此權證）'
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`本地伺服器運行於 http://localhost:${PORT}`);
    });
}
