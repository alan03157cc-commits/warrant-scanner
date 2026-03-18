const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

async function fetchRealTimeWarrants(stockCode) {
    try {
        const searchUrl = `https://www.warrantwin.com.tw/eyuanta/Warrant/Search.aspx?SID=${stockCode.trim()}`;

        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
                'Referer': 'https://www.warrantwin.com.tw/eyuanta/'
            },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);
        const warrants = [];

        // 找表格：通常是 class 含 grid 或 gv (GridView)，或 id 含 ContentPlaceHolder1_gv
        const tableRows = $('table tr').filter((i, el) => $(el).find('td a[href*="Info.aspx?WID="]').length > 0);

        tableRows.each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length < 12) return;

            const warrantLink = cols.eq(0).find('a').text().trim(); // e.g. [030190]
            if (!warrantLink) return;

            const symbolMatch = warrantLink.match(/\[(\w+)\]/);
            const symbol = symbolMatch ? symbolMatch[1] : '';
            const name = cols.eq(1).text().trim(); // 權證名稱

            const days = parseInt(cols.eq(8).text().trim()) || 0; // 剩餘天數
            let moneynessStr = cols.eq(9).text().trim(); // 價內外程度 e.g. 43.14%價內
            let moneyness = parseFloat(moneynessStr.replace(/[^0-9.-]/g, '')) || 0;
            if (moneynessStr.includes('價外')) moneyness = -moneyness;

            const spreadPercent = parseFloat(cols.eq(10).text().trim().replace('%', '')) || 0; // 買賣價差比%
            const lev = parseFloat(cols.eq(11).text().trim()) || 0; // 實質槓桿
            const iv = parseFloat(cols.eq(12).text().trim().replace('%', '')) || 0; // 成交價隱波

            // 買賣價：如果有買價/賣價欄（可加項目），否則 fallback 到成交價
            let bid = parseFloat(cols.eq(/* 買價 index，如果有 */).text().trim()) || parseFloat(cols.eq(2).text().trim()) || 0;
            let ask = parseFloat(cols.eq(/* 賣價 index */).text().trim()) || parseFloat(cols.eq(2).text().trim()) || 0;

            if (symbol && days > 0 && lev > 0 && (bid > 0 || ask > 0)) {
                warrants.push({
                    symbol,
                    name,
                    days,
                    moneyness,
                    bid,
                    ask,
                    lev,
                    delta: 0, // 暫無，可從個股頁抓
                    iv
                });
            }
        });

        if (warrants.length === 0) {
            // 檢查是否有 "沒有相關條件商品！" 文字
            if ($('body').text().includes('沒有相關條件商品')) {
                throw new Error(`元大未發行 ${stockCode} 的權證`);
            }
            throw new Error('無法解析權證表格，可能頁面結構變更');
        }

        return warrants;
    } catch (error) {
        console.error('元大錯誤:', error.message, error.stack);
        throw error;
    }
}

function filterWarrants(warrants, mode = 'swing') {
    const passed = warrants
        .filter(w => {
            if (w.days <= 0 || w.lev <= 0 || (w.bid <= 0 && w.ask <= 0)) return false;

            const midPrice = (w.bid + w.ask) / 2 || w.ask || w.bid;
            const spread = midPrice > 0 ? Math.abs(w.ask - w.bid) / midPrice : 0;
            const dlr = midPrice > 0 ? spread / w.lev : Infinity;

            if (mode === 'short') {
                return w.days >= 30 && w.days <= 120 && w.moneyness >= -5 && w.moneyness <= 5 && dlr <= 0.0015;
            } else {
                return w.days >= 60 && w.days <= 180 && w.moneyness >= -10 && w.moneyness <= 5 && dlr <= 0.0020;
            }
        })
        .map(w => {
            const mid = (w.bid + w.ask) / 2 || w.ask || w.bid;
            const spread = mid > 0 ? Math.abs(w.ask - w.bid) / mid : 0;
            const dlr = mid > 0 ? spread / w.lev : Infinity;
            return {
                ...w,
                dlr_percent: dlr < Infinity ? (dlr * 100).toFixed(3) + '%' : 'N/A',
                score: Math.round(100 - (dlr < Infinity ? dlr * 15000 : 0))
            };
        });

    return passed.sort((a, b) => b.score - a.score).slice(0, 10);
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

    try {
        const raw = await fetchRealTimeWarrants(stock);
        const filtered = filterWarrants(raw, mode || 'swing');
        res.json({ target: stock, mode: mode || 'swing', count: filtered.length, data: filtered });
    } catch (err) {
        console.error('API 錯誤:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;
