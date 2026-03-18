const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 從元大權證網抓取即時權證資料（爬蟲版）
 * @param {string} stockCode - 股票代號，如 '2330'
 */
async function fetchRealTimeWarrants(stockCode) {
    try {
        const searchUrl = `https://www.warrantwin.com.tw/eyuanta/Warrant/Search.aspx?SID=${stockCode}`;

        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.8,en-US;q=0.5,en;q=0.3',
                'Referer': 'https://www.warrantwin.com.tw/eyuanta/',
                'Connection': 'keep-alive'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const warrants = [];

        // 解析表格：元大結果為 <table> 內多行 <tr>，第一行 header
        // 實際 selector 依頁面調整；這裡假設權證代碼在 <a href="Info.aspx?WID=...">
        $('a[href*="Info.aspx?WID="]').each((i, el) => {
            const link = $(el).text().trim();
            if (!link.includes(']')) return; // 跳過非權證連結

            const [codePart, namePart] = link.split(']');
            const symbol = codePart.replace('[', '').trim();
            const name = namePart.trim();

            // 找同列的 td（parent tr 的 siblings）
            const row = $(el).closest('tr');
            const cols = row.find('td');

            // 欄位位置需依實際調整（用 F12 確認）
            // 範例位置（可能變動）：
            // 0: 權證代號 (已取)
            // 1: 名稱
            // 2: 成交價
            // 8: 剩餘天數
            // 9: 價內外程度 (e.g., 43.14%價內)
            // 10: 買賣價差比%
            // 11: 實質槓桿
            // 12: 隱波%
            const daysText = cols.eq(8)?.text().trim() || '0';
            const moneynessText = cols.eq(9)?.text().trim() || '';
            const spreadText = cols.eq(10)?.text().trim() || '0';
            const levText = cols.eq(11)?.text().trim() || '0';
            const ivText = cols.eq(12)?.text().trim() || '0';

            const bid = parseFloat(cols.eq(/* 買價欄位 */)?.text().trim()) || 0; // 需確認
            const ask = parseFloat(cols.eq(/* 賣價欄位 */)?.text().trim()) || 0;

            const days = parseInt(daysText) || 0;
            let moneyness = parseFloat(moneynessText.replace(/[^0-9.-]/g, '')) || 0;
            if (moneynessText.includes('價外')) moneyness = -moneyness; // 價外負值

            const lev = parseFloat(levText) || 0;
            const iv = parseFloat(ivText) || 0;

            if (symbol && days > 0 && lev > 0) {
                warrants.push({
                    symbol,
                    name,
                    days,
                    moneyness,
                    bid,
                    ask,
                    lev,
                    delta: 0, // 元大不直接顯示，可後續從 Info.aspx 抓
                    iv
                });
            }
        });

        if (warrants.length === 0) {
            throw new Error(`元大未發行 ${stockCode} 的權證，或頁面結構變更`);
        }

        return warrants;
    } catch (error) {
        console.error('元大 fetch 錯誤:', error.message);
        throw new Error('無法從元大載入權證資料，請檢查網路或頁面是否更新');
    }
}

/**
 * 過濾邏輯（調整為元大欄位）
 */
function filterWarrants(warrants, mode = 'swing') {
    const passed = warrants
        .filter(w => {
            if (w.days <= 0 || w.ask <= 0 || w.bid <= 0 || w.lev <= 0) return false;

            const spread = (w.ask - w.bid) / w.ask || 0;
            const dlr = spread / w.lev;

            if (mode === 'short') {
                return (
                    w.days >= 30 && w.days <= 120 &&
                    w.moneyness >= -5 && w.moneyness <= 5 &&
                    dlr <= 0.0015
                );
            } else {
                return (
                    w.days >= 60 && w.days <= 180 &&
                    w.moneyness >= -10 && w.moneyness <= 5 &&
                    dlr <= 0.0020
                );
            }
        })
        .map(w => {
            const spread = (w.ask - w.bid) / w.ask || 0;
            const dlr = spread / w.lev;
            return {
                ...w,
                dlr_percent: (dlr * 100).toFixed(3) + '%',
                score: Math.round(100 - dlr * 15000)
            };
        });

    return passed.sort((a, b) => b.score - a.score).slice(0, 10);
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號，例如 ?stock=2330' });

    try {
        const raw = await fetchRealTimeWarrants(stock);
        const filtered = filterWarrants(raw, mode || 'swing');
        res.json({
            target: stock,
            mode: mode || 'swing',
            count: filtered.length,
            data: filtered
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;
