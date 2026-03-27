const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 股票代號對應表 (目前先寫入華新科 2492，後續可自行擴充)
const stockCodeMap = {
    '2492': '11472',
};

// 核心抓取引擎：向凱基 API 請求即時資料
async function fetchRealTimeWarrants(stockCode) {
    const internalId = stockCodeMap[stockCode];
    if (!internalId) {
        throw new Error(`目前系統尚未建立 ${stockCode} 的凱基內部對應碼。`);
    }

    try {
        const apiUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
        const parametersOfJson = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
            "STRIKE_FROM": -1, "STRIKE_TO": -1, "VOLUME": -1,
            "UND_INSTR_INSNBR": internalId, 
            "LAST_DAYS_FROM": -1, "LAST_DAYS_TO": -1, "IMP_VOL": -1, "CP": "ALL",
            "IN_OUT_PERCENT_FROM": -1, "IN_OUT_PERCENT_TO": -1,
            "BID_ASK_SPREAD_PERCENT": -1, "LEVERAGE": -1, "EXECRATE": -1,
            "OUTSTANDING_PERCENT": -1, "BARRIER_DEAL_PERCENT": -1,
            "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
        });

        const requestData = qs.stringify({
            serviceId: 'S0600013_GetWarrants',
            parametersOfJson: parametersOfJson
        });

        const response = await axios.post(apiUrl, requestData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://warrant.kgi.com/edwebsite/views/warrantsearch/warrantsearch.aspx'
            }
        });

        // 剖析 XML 取得 JSON
        const xmlText = response.data;
        const jsonMatch = xmlText.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (!jsonMatch || !jsonMatch[1]) throw new Error('解析 XML 失敗，找不到資料');

        const rawData = JSON.parse(jsonMatch[1]);
        const formattedWarrants = [];

        // 欄位轉換
        for (let item of rawData) {
            formattedWarrants.push({
                symbol: item.INSTR_STKID,              
                name: item.INSTR_NAME,                 
                days: parseInt(item.LAST_DAYS),        
                moneyness: parseFloat(item.IN_OUT_PERCENT), 
                bid: parseFloat(item.BID1_PRICE),      
                ask: parseFloat(item.ASK1_PRICE),      
                lev: parseFloat(item.LEVERAGE),        
                delta: parseFloat(item.DELTA),         
                iv: parseFloat(item.BID_IMP_VOL)       
            });
        }
        return formattedWarrants;
    } catch (error) {
        throw error;
    }
}

// 三階段過濾演算法
function filterWarrants(warrants, mode) {
    let passed = [];

    warrants.forEach(w => {
        // 排除無效報價
        if (!w.ask || w.ask <= 0 || !w.bid || w.bid <= 0 || !w.lev || w.lev <= 0) return;

        let dlr = ((w.ask - w.bid) / w.ask) / w.lev;

        if (mode === 'short') {
            if (w.days < 30) return;
            if (w.moneyness < -5 || w.moneyness > 5) return;
            if (w.delta < 0.5 || w.delta > 0.8) return;
            if (dlr > 0.0015) return; 
        } else if (mode === 'swing') {
            if (w.days < 60) return;
            if (w.moneyness < -10 || w.moneyness > 5) return;
            if (w.delta < 0.4 || w.delta > 0.6) return;
            if (dlr > 0.0020) return; 
        }

        passed.push({
            ...w,
            dlr_percent: (dlr * 100).toFixed(2) + '%',
            score: 100 - (dlr * 10000)
        });
    });

    return passed.sort((a, b) => b.score - a.score).slice(0, 10);
}

// API 路由
app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少股票代號' });

    try {
        const rawWarrants = await fetchRealTimeWarrants(stock);
        const results = filterWarrants(rawWarrants, mode || 'swing');
        res.json({ target: stock, mode, count: results.length, data: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Vercel 專屬輸出
module.exports = app;

// 本機開發啟動 (僅在直接執行時)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ 伺服器已啟動: http://localhost:${PORT}`);
    });
}