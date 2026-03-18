const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let internalCodeCache = null;

// 自動從凱基取得全市場股票 ID 轉換表
async function getInternalId(targetStock) {
    try {
        if (!internalCodeCache) {
            const res = await axios.post('https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList', {}, { timeout: 5000 });
            internalCodeCache = res.data;
        }
        const match = internalCodeCache.find(item => item.UnderlyingId.trim() === targetStock.trim());
        return match ? match.UnderlyingInsnbr : null;
    } catch (e) { return null; }
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代碼' });

    try {
        const internalId = await getInternalId(stock);
        if (!internalId) throw new Error(`找不到股票代號 ${stock}`);

        const parametersOfJson = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
            "UND_INSTR_INSNBR": internalId, 
            "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
        });

        const response = await axios.post('https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService', 
            qs.stringify({ serviceId: 'S0600013_GetWarrants', parametersOfJson }), 
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
        );

        const xmlText = response.data;
        const jsonMatch = xmlText.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (!jsonMatch) throw new Error('目前查無此標的之權證資料');

        const rawData = JSON.parse(jsonMatch[1]);
        const results = rawData.map(item => ({
            symbol: item.INSTR_STKID, name: item.INSTR_NAME,
            days: parseInt(item.LAST_DAYS), moneyness: parseFloat(item.IN_OUT_PERCENT),
            bid: parseFloat(item.BID1_PRICE || 0), ask: parseFloat(item.ASK1_PRICE || 0),
            lev: parseFloat(item.LEVERAGE || 0), delta: parseFloat(item.DELTA || 0)
        })).filter(w => {
            if (w.ask <= 0 || w.lev <= 0) return false;
            let dlr = ((w.ask - w.bid) / w.ask) / w.lev;
            // 篩選邏輯：短線 DLR < 0.15% | 波段 DLR < 0.20%
            return mode === 'short' ? (w.days >= 30 && dlr <= 0.0015) : (w.days >= 60 && dlr <= 0.0020);
        });

        res.json({ data: results.slice(0, 10) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;
