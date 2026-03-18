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

        // 把 html 轉成行陣列（移除標籤後的純文字）
        const cleanHtml = html.replace(/<[^>]+>/g, '\n').replace(/\s+/g, ' ').trim();
        const lines = cleanHtml.split('\n').map(l => l.trim()).filter(l => l);

        const warrants = [];
        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i];
            const nextLine = lines[i + 1];

            // 找連結行：包含 [數字] 和 Info.aspx?WID
            if (line.includes('[ ') && line.includes('Info.aspx?WID=')) {
                // 取出 symbol 和 name
                const symbolMatch = line.match(/\[(\d{6})\]/);
                const symbol = symbolMatch ? symbolMatch[1] : null;

                const nameMatch = line.match(/\]\s*([^\[]+)/);
                const name = nameMatch ? nameMatch[1].trim() : '未知';

                if (!symbol) continue;

                // 下一行是數據：split 空格
                const dataParts = nextLine.split(/\s+/).filter(p => p && p !== '--');

                if (dataParts.length < 10) continue;

                // 固定位置（根據頁面樣本）
                const days = parseInt(dataParts[6]) || 0; // index 6: 剩餘日
                const moneynessStr = dataParts[7] || ''; // index 7: 價內外
                let moneyness = parseFloat(moneynessStr.replace(/[^0-9.-]/g, '')) || 0;
                if (moneynessStr.includes('價外')) moneyness = -moneyness;

                const lev = parseFloat(dataParts[9]) || 0; // index 9: 實質槓桿

                const bid = parseFloat(dataParts[0]) * 0.98 || 0;
                const ask = parseFloat(dataParts[0]) * 1.02 || 0;

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
                    console.log(`成功解析：${symbol} ${name} | 天數:${days} | 價內外:${moneyness} | 槓桿:${lev}`);
                }
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
            // 測試超寬鬆，讓 2330 顯示
            if (mode === 'short') {
                return w.days >= 5 && w.moneyness >= -200 && w.moneyness <= 200 && parseFloat(w.dlr_percent) <= 2.0;
            } else {
                return w.days >= 10 && w.moneyness >= -200 && w.moneyness <= 200 && parseFloat(w.dlr_percent) <= 2.0;
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
            debug: {
                rawCount: raw.length,
                msg: raw.length > 0 ? '有資料但過濾沒通過（門檻太嚴）' : '解析失敗或元大無資料'
            }
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
