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

        // 清理成純文字 + 行陣列
        const clean = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
        const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 5);

        const warrants = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];

            // 找權證連結行
            if (line.match(/\[\d{6}\]/) && line.includes('Info.aspx?WID=')) {
                const symbolMatch = line.match(/\[(\d{6})\]/);
                const symbol = symbolMatch ? symbolMatch[1] : null;

                const name = line.replace(/^\[\d{6}\]\s*/, '').trim();

                if (!symbol) { i++; continue; }

                // 找下一筆數據行（可能下一行或再下一行）
                let dataLine = '';
                for (let j = 1; j <= 3 && i + j < lines.length; j++) {
                    const candidate = lines[i + j];
                    if (candidate.match(/[\d.-]+/) && candidate.length > 20) {
                        dataLine = candidate;
                        break;
                    }
                }

                if (!dataLine) {
                    console.log(`找不到數據行 for ${symbol}`);
                    i++;
                    continue;
                }

                console.log(`找到數據行 for ${symbol}: ${dataLine.substring(0, 150)}...`);

                // split 空格，過濾空和 --
                const parts = dataLine.split(/\s+/).filter(p => p && p !== '--');

                if (parts.length < 8) {
                    i++;
                    continue;
                }

                // 位置彈性取（剩餘天數通常在 6-7 位）
                const daysIndex = parts.findIndex(p => /^\d{1,3}$/.test(p) && parseInt(p) < 365);
                const days = daysIndex >= 0 ? parseInt(parts[daysIndex]) : 0;

                // 價內外：找包含「價內」「價外」的字串
                const moneynessPart = parts.find(p => p.includes('價內') || p.includes('價外')) || '';
                let moneyness = parseFloat(moneynessPart.replace(/[^0-9.-]/g, '')) || 0;
                if (moneynessPart.includes('價外')) moneyness = -moneyness;

                // 槓桿：找數字在 1-20 範圍
                const levPart = parts.find(p => /^\d+\.?\d*$/.test(p) && parseFloat(p) >= 1 && parseFloat(p) <= 20) || '';
                const lev = parseFloat(levPart) || 0;

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

                i += 2; // 跳過數據行
            } else {
                i++;
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
            // 暫時超寬鬆，讓資料先顯示
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
            debug: raw.length > 0 ? '成功解析到資料' : '解析失敗（元大頁面格式不匹配）'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`本地伺服器：http://localhost:${PORT}`));
}
