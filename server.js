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
        const postData = {
            'Underlying': stockCode.trim(),
            'WarrantType': 'C', // C=認購, P=認售, ALL=全部
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
        };

        const response = await axios.post(url, postData, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Referer': 'https://extweb.capital.com.tw/Extproduct/Program/Warrant/IndexWarrant/WarrantSearch.html',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 20000
        });

        const html = response.data;
        console.log(`群益頁面長度：${html.length}`);

        // 簡單清理 + 找行
        const clean = html.replace(/<[^>]+>/g, '\n').replace(/\s+/g, ' ').trim();
        const lines = clean.split('\n').map(l => l.trim()).filter(l => l);

        const warrants = [];
        for (let i = 0; i < lines.length - 5; i++) {
            const chunk = lines.slice(i, i + 10).join(' ');

            // 找權證代碼 (6位數字)
            const symbolMatch = chunk.match(/(\d{6})/);
            if (!symbolMatch) continue;

            const symbol = symbolMatch[1];

            // 名稱：通常在代碼附近
            const nameMatch = chunk.match(/(\w+元大\w+)/) || chunk.match(/(\w+)/);
            const name = nameMatch ? nameMatch[1] : '未知';

            // 天數：找數字 + 天/日
            const daysMatch = chunk.match(/(\d{1,3})\s*(?:天|日)/);
            const days = daysMatch ? parseInt(daysMatch[1]) : 0;

            // 價內外：數字 + 價內/價外
            const moneynessMatch = chunk.match(/([\d.]+)\s*(價內|價外)/);
            let moneyness = 0;
            if (moneynessMatch) {
                moneyness = parseFloat(moneynessMatch[1]);
                if (moneynessMatch[2].includes('價外')) moneyness = -moneyness;
            }

            // 槓桿：數字
            const levMatch = chunk.match(/槓桿\s*([\d.]+)/) || chunk.match(/([\d.]+)\s*槓桿/);
            const lev = levMatch ? parseFloat(levMatch[1]) : 0;

            if (days > 0 && lev > 0) {
                warrants.push({
                    symbol,
                    name,
                    days,
                    moneyness,
                    bid: 0, // 群益頁面需再抓買賣價
                    ask: 0,
                    lev,
                    delta: 0,
                    iv: 0
                });
                console.log(`群益成功解析：${symbol} ${name} | 天數:${days} | 價內外:${moneyness} | 槓桿:${lev}`);
            }

            i += 5; // 跳過重複
        }

        console.log(`總解析到 ${warrants.length} 筆`);

        return warrants;
    } catch (err) {
        console.error('群益抓取失敗：', err.message);
        return [];
    }
}

function filterWarrants(warrants, mode = 'swing') {
    console.log(`過濾：${mode}，原始 ${warrants.length} 筆`);
    return warrants; // 先全部回傳測試
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
            note: raw.length > 0 ? '成功從群益抓到資料' : '群益也無資料或解析失敗'
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
