const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

console.log('Server 啟動中...');

async function fetchRealTimeWarrants(stockCode) {
    console.log(`查詢群益權證：${stockCode}`);
    try {
        const url = 'https://extweb.capital.com.tw/Extproduct/Program/Warrant/IndexWarrant/WarrantSearch.html';
        const postData = new URLSearchParams({
            'Underlying': stockCode.trim(),
            'WarrantType': 'ALL', // ALL = 認購+認售
            'Issuer': 'ALL',
            'LastDaysFrom': '',
            'LastDaysTo': '',
            'MoneynessFrom': '',
            'MoneynessTo': '',
            'LeverageFrom': '',
            'LeverageTo': '',
            'IVFrom': '',
            'IVTo': '',
            'BidAskSpreadFrom': '',
            'BidAskSpreadTo': '',
            'OutstandingFrom': '',
            'OutstandingTo': '',
            'SortBy': 'LastDays',
            'SortOrder': 'ASC'
        }).toString();

        const response = await axios.post(url, postData, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Referer': 'https://extweb.capital.com.tw/Extproduct/Program/Warrant/IndexWarrant/WarrantSearch.html',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
            },
            timeout: 20000
        });

        const html = response.data;
        console.log(`群益頁面取得，長度：${html.length}`);

        // 清理成純文字行
        const clean = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
        const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 10);

        const warrants = [];
        let currentSymbol = null;
        let currentName = null;

        for (const line of lines) {
            // 找權證代碼 (6位數字開頭)
            const symbolMatch = line.match(/^(\d{6})\s/);
            if (symbolMatch) {
                currentSymbol = symbolMatch[1];
                currentName = line.replace(/^\d{6}\s*/, '').trim();
                continue;
            }

            if (currentSymbol) {
                // 天數：找數字 + 天/日/剩餘
                const daysMatch = line.match(/(\d{1,3})\s*(?:天|日|剩餘)/);
                const days = daysMatch ? parseInt(daysMatch[1]) : 0;

                // 價內外：找數字 + 價內/價外
                const moneynessMatch = line.match(/([\d.]+)\s*(價內|價外)/);
                let moneyness = 0;
                if (moneynessMatch) {
                    moneyness = parseFloat(moneynessMatch[1]);
                    if (moneynessMatch[2].includes('價外')) moneyness = -moneyness;
                }

                // 實質槓桿：找數字
                const levMatch = line.match(/實質槓桿\s*([\d.]+)/) || line.match(/槓桿\s*([\d.]+)/);
                const lev = levMatch ? parseFloat(levMatch[1]) : 0;

                if (days > 0 && lev > 0) {
                    warrants.push({
                        symbol: currentSymbol,
                        name: currentName || '未知',
                        days,
                        moneyness,
                        bid: 0, // 群益頁面需再抓買賣價，這裡先估計
                        ask: 0,
                        lev,
                        delta: 0,
                        iv: 0
                    });
                    console.log(`群益解析成功：${currentSymbol} ${currentName || ''} | 天數:${days} | 價內外:${moneyness} | 槓桿:${lev}`);
                }

                currentSymbol = null;
            }
        }

        console.log(`總解析到 ${warrants.length} 筆群益權證`);

        return warrants;
    } catch (err) {
        console.error('群益抓取失敗：', err.message);
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
            if (mode === 'short') {
                return w.days >= 10 && w.moneyness >= -50 && w.moneyness <= 50 && parseFloat(w.dlr_percent) <= 1.0;
            } else {
                return w.days >= 20 && w.moneyness >= -50 && w.moneyness <= 50 && parseFloat(w.dlr_percent) <= 1.0;
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
                msg: raw.length > 0 ? '成功從群益抓到真實資料' : '群益無資料或解析失敗'
            }
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
