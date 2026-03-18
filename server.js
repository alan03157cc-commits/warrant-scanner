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
        console.log(`頁面取得成功，長度：${html.length}`);

        // 清理成純文字 + 行
        const clean = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
        const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 20);

        const warrants = [];
        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i];
            const nextLine = lines[i + 1];

            // 找權證連結行
            if (line.match(/\[\d{6}\]/)) {
                const symbolMatch = line.match(/\[(\d{6})\]/);
                const symbol = symbolMatch ? symbolMatch[1] : null;

                const name = line.replace(/^\[\d{6}\]\s*/, '').trim();

                if (!symbol) continue;

                // 數據行 split
                const parts = nextLine.split(/\s+/).filter(p => p && p !== '--' && p !== '');

                if (parts.length < 8) {
                    console.log(`數據行太短，跳過：${nextLine.substring(0, 80)}...`);
                    continue;
                }

                console.log(`找到數據行 for ${symbol}: ${parts.join(' | ')}`);

                // 彈性取剩餘天數（找 1~365 的純數字）
                let days = 0;
                for (const p of parts) {
                    const num = parseInt(p);
                    if (!isNaN(num) && num > 0 && num < 365) {
                        days = num;
                        break;
                    }
                }

                // 價內外：找包含價內/價外的字串
                const moneynessPart = parts.find(p => p.includes('價內') || p.includes('價外')) || '';
                let moneyness = parseFloat(moneynessPart.replace(/[^0-9.-]/g, '')) || 0;
                if (moneynessPart.includes('價外')) moneyness = -moneyness;

                // 實質槓桿：找合理範圍數字 (1~30)
                let lev = 0;
                for (const p of parts) {
                    const num = parseFloat(p);
                    if (!isNaN(num) && num > 1 && num < 30) {
                        lev = num;
                        break;
                    }
                }

                const price = parseFloat(parts[0]) || 1.0;
                const bid = price * 0.98;
                const ask = price * 1.02;

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
                } else {
                    console.log(`無效筆：${symbol} 天數:${days} 槓桿:${lev}`);
                }

                i++; // 跳過數據行
            }
        }

        console.log(`總解析到 ${warrants.length} 筆權證`);

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
            // 暫時極寬鬆，讓資料先出來
            return w.days >= 5 && parseFloat(w.dlr_percent) <= 3.0;
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
                msg: raw.length > 0 ? '成功抓到真實資料' : '解析失敗（元大頁面格式變了或無資料）'
            }
        });
    } catch (err) {
        console.error('API 錯誤：', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`本地伺服器：http://localhost:${PORT}`));
}
