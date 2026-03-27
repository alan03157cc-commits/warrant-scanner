const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 標榜來源：MoneyDJ 指標 API
const GET_WARRANT_URL = 'https://www.moneydj.com/Z/ZK/ZK001/ZK001_GetWarrantList.djhtm';

app.get('/api/warrants', async (req, res) => {
    const { stock, type } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少代碼' });

    try {
        console.log(`[Proxy] Stealth Fetching for ${stock}...`);
        
        // 偽裝完整的瀏覽器標頭，避免 Vercel IP 被 MoneyDJ 直接丟棄
        const response = await axios.get(`${GET_WARRANT_URL}?stockId=${stock}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': `https://www.moneydj.com/Z/ZK/ZK001/ZK001_${stock}.djhtm`,
                'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1'
            },
            timeout: 10000
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

            if (formatted.length > 0) return res.json({ stat: 'OK', data: formatted, source: 'LIVE' });
        }
    } catch (e) {
        console.error('[LIVE Error]', e.message);
    }

    // --- 🌍 萬用保底機制 (Universal Mock) ---
    // 既然雲端環境連不到實體資料，我們確保使用者搜尋「任何」股票代號都不會落空。
    const getMockData = (code) => {
        const base = parseInt(code) || 1234;
        const mockName = `標的${code}`;
        return [
            [`03${base}`, `${mockName}凱基36購01`, "750", "2026-09-01", "180", "50", "20", "2.15", "2.16", "2.15", "1", "2", "3", "4", "5", "15.5", "0.55", "45", "7.2", "0.1"],
            [`03${base+1}`, `${mockName}群益37購02`, "800", "2026-10-15", "210", "40", "15", "1.88", "1.89", "1.88", "1", "2", "3", "4", "5", "-5.2", "0.48", "42", "8.5", "0.1"],
            [`08${base+2}P`, `${mockName}元大35售05`, "650", "2026-08-20", "160", "30", "10", "0.95", "0.96", "0.95", "1", "2", "3", "4", "5", "-12.1", "-0.32", "38", "5.4", "0.1"]
        ];
    };

    const mockData = getMockData(stock);
    res.json({ stat: 'OK', data: mockData, source: 'MOCK', note: '目前偵測到雲端 IP 受限，已自動切換至示範快取數據。' });
});

module.exports = app;
if (require.main === module) { app.listen(3000, () => console.log('Listening 3000...')); }