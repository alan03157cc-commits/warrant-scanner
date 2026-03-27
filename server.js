const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/warrants', async (req, res) => {
    const { stock, type } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少代碼' });

    try {
        console.log(`[Proxy] Scraping MoneyDJ for ${stock} (${type})...`);
        // MoneyDJ 標的頁面 (例如: https://www.moneydj.com/Z/ZK/ZK001/ZK001_2330.djhtm)
        const url = `https://www.moneydj.com/Z/ZK/ZK001/ZK001_${stock}.djhtm`;
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Referer': 'https://www.moneydj.com/'
            },
            timeout: 8000
        });

        const $ = cheerio.load(response.data);
        const data = [];
        
        // MoneyDJ 的表格通常 class 為 t10
        $('table.t10 tr').each((i, row) => {
            if (i < 1) return; // 跳過標題
            const cols = $(row).find('td');
            if (cols.length < 10) return;

            const nameStr = $(cols[0]).text().trim(); // 代號 + 名稱
            const code = nameStr.match(/\d+/)?.[0] || '';
            const price = $(cols[1]).text().trim() || '0';
            const strike = $(cols[3]).text().trim() || '0';
            const inOut = $(cols[4]).text().trim() || '0';
            const lev = $(cols[6]).text().trim() || '0';
            const days = $(cols[8]).text().trim() || '0';
            const typeStr = $(cols[10]).text().trim(); // 類型 (認購/認售)

            // 過濾類型
            if (type && typeStr && !typeStr.includes(type === 'P' ? '認售' : '認購')) return;

            // 偽裝成證交所格式
            data.push([
                code, nameStr, strike, '', days, '0', '0', price, price,
                price, '0', '0', '0', '0', '0', inOut,
                '0', '0', lev, '0'
            ]);
        });

        if (data.length > 0) {
            console.log(`[MoneyDJ] Success: found ${data.length} items for ${stock}`);
            return res.json({ stat: 'OK', data: data });
        }
    } catch (e) {
        console.error('[MoneyDJ Engine Failed]', e.message);
    }

    // 備援: 證交所 (TWSE) - 雖然可能被擋，但作為保底
    try {
        const twseResp = await axios.get(`https://www.twse.com.tw/rwd/zh/warrant/${type === 'P' ? 'TWTBUU' : 'TWTAUU'}?response=json&stockNo=${stock}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000
        });
        if (twseResp.data && twseResp.data.data) return res.json(twseResp.data);
    } catch (e) {}

    res.json({ stat: 'FAIL', data: [], message: `目前標的 ${stock} 無即時權證資料或伺服器忙碌。` });
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ MoneyDJ 爬選模式啟動: http://localhost:${PORT}`);
    });
}