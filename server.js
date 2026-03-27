const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 核心資料來源：MoneyDJ 指標 API
const GET_WARRANT_URL = 'https://www.moneydj.com/Z/ZK/ZK001/ZK001_GetWarrantList.djhtm';

app.get('/api/warrants', async (req, res) => {
    const { stock, type } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少代碼' });

    try {
        console.log(`[Proxy] Fetching MoneyDJ for ${stock}...`);
        const response = await axios.get(`${GET_WARRANT_URL}?stockId=${stock}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.moneydj.com/'
            },
            timeout: 6000
        });

        let rawData = response.data;
        if (typeof rawData === 'string' && rawData.includes('[[')) {
            const start = rawData.indexOf('[[');
            const end = rawData.lastIndexOf(']]') + 2;
            rawData = JSON.parse(rawData.substring(start, end));
        }

        if (Array.isArray(rawData) && rawData.length > 0) {
            const formatted = rawData.map(d => {
                const wType = d[10] || ''; 
                if (type && wType !== (type === 'P' ? '認售' : '認購')) return null;
                return [
                    d[0], d[1], d[3] || '0', '', d[8] || '0', '0', '0', d[2] || '0', d[2] || '0',
                    d[2] || '0', '0', '0', '0', '0', '0', d[4] || '0', '0', '0', d[6] || '0', '0'
                ];
            }).filter(x => x !== null);

            if (formatted.length > 0) {
                console.log(`[Proxy] LIVE Success: ${formatted.length} items.`);
                return res.json({ stat: 'OK', source: 'LIVE', data: formatted });
            }
        }
    } catch (e) {
        console.error('[Proxy LIVE Failed]', e.message);
    }

    // --- 🌍 萬用示範數據 (Universal Demo Data) ---
    // 解決 Vercel IP 被封阻的問題，確保搜尋任何標的都有資料跳出
    const generateMock = (code) => {
        const base = parseInt(code) || 1234;
        const res = [];
        const issuers = ['元大', '群益', '凱基', '永豐', '富邦', '中信'];
        for(let i=1; i<=15; i++) {
            const isCall = i <= 10;
            if (type && isCall !== (type === 'C')) continue;
            
            const name = `${stock}${issuers[i%issuers.length]}${35+i}購0${i}`;
            const strike = (800 + i*10).toString();
            const days = (100 + i*15).toString();
            const mon = (i % 2 === 0 ? "+" : "-") + (i*2.5).toFixed(1);
            const lev = (5 + i*0.5).toFixed(1);
            const price = (0.5 + i*0.2).toFixed(2);
            
            res.push([
                `03${base+i}${isCall?'':'P'}`, name, strike, "2026-10-15", days, "5000", "1200", 
                price, price, price, "0", "0", "0", "0", "0", mon, "0", "0", lev, "0"
            ]);
        }
        return res;
    };

    const mockData = generateMock(stock);
    res.json({ stat: 'OK', source: 'MOCK', data: mockData, note: '雲端受限，目前為示範數據' });
});

module.exports = app;
if (require.main === module) { 
    app.listen(3000, () => console.log('Listening for search...'));
}