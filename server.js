const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 核心：即時找出代號對應的內部編號
 * 邏輯：直接向凱基標的清單 API 請求，並過濾出使用者輸入的那一檔
 */
async function getInsnbrRealTime(stockCode) {
    try {
        const target = stockCode.trim();
        const res = await axios.post('https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList', {}, { timeout: 5000 });
        
        if (res.data && Array.isArray(res.data)) {
            // 直接在回傳的大清單中，用 find 抓出你要的那一個代號
            const match = res.data.find(item => item.UnderlyingId.trim() === target);
            if (match) {
                console.log(`🎯 找到對應：${target} -> ${match.UnderlyingInsnbr}`);
                return match.UnderlyingInsnbr;
            }
        }
        return null;
    } catch (e) {
        console.error("無法連線至凱基標的 API:", e.message);
        return null;
    }
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

    try {
        // 第一步：即時去翻找編號
        const internalId = await getInsnbrRealTime(stock);
        
        if (!internalId) {
            throw new Error(`找不到股票代號 ${stock}，請確認該股是否有發行權證。`);
        }

        // 第二步：拿著編號去抓權證資料
        const parametersOfJson = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0,
            "INSWRT_ISSUER_NAME": "ALL",
            "UND_INSTR_INSNBR": internalId, 
            "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
        });

        const response = await axios.post('https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService', 
            qs.stringify({ serviceId: 'S0600013_GetWarrants', parametersOfJson }), 
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
        );

        const xmlText = response.data;
        const jsonMatch = xmlText.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (!jsonMatch) throw new Error('解析權證資料失敗');

        const rawData = JSON.parse(jsonMatch[1]);
        const results = rawData.map(item => ({
            symbol: item.INSTR_STKID,
            name: item.INSTR_NAME,
            days: parseInt(item.LAST_DAYS),
            moneyness: parseFloat(item.IN_OUT_PERCENT),
            bid: parseFloat(item.BID1_PRICE || 0),
            ask: parseFloat(item.ASK1_PRICE || 0),
            lev: parseFloat(item.LEVERAGE || 0),
            delta: parseFloat(item.DELTA || 0)
        })).filter(w => {
            if (w.ask <= 0 || w.lev <= 0) return false;
            let dlr = ((w.ask - w.bid) / w.ask) / w.lev;
            // 你的核心過濾標準
            return mode === 'short' ? (w.days >= 30 && dlr <= 0.0015) : (w.days >= 60 && dlr <= 0.0020);
        });

        res.json({ data: results.slice(0, 10) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;
