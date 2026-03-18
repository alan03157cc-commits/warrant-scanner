const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 記憶體快取：儲存全市場代碼對應表，避免重複抓取
let internalCodeCache = null;

/**
 * 自動取得凱基內部的股票 ID 對應表
 */
async function getInternalId(targetStock) {
    try {
        if (!internalCodeCache) {
            console.log("正在從凱基初始化全市場代碼對應表...");
            const response = await axios.post('https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList', 
            {}, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://warrant.kgi.com/edwebsite/views/warrantsearch/warrantsearch.aspx'
                }
            });
            internalCodeCache = response.data;
        }

        // 搜尋匹配的代號
        const match = internalCodeCache.find(item => item.UnderlyingId.trim() === targetStock.trim());
        
        if (match) {
            return match.UnderlyingInsnbr;
        } else {
            throw new Error(`找不到代號 ${targetStock}，請確認該股是否有權證。`);
        }
    } catch (error) {
        console.error("對應表轉換失敗:", error.message);
        throw error;
    }
}

/**
 * 核心抓取引擎：請求即時權證資料
 */
async function fetchRealTimeWarrants(stockCode) {
    try {
        const internalId = await getInternalId(stockCode);

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

        const xmlText = response.data;
        const jsonMatch = xmlText.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (!jsonMatch || !jsonMatch[1]) throw new Error('解析 XML 失敗或目前無權證資料');

        const rawData = JSON.parse(jsonMatch[1]);
        const formattedWarrants = [];

        for (let item of rawData) {
            formattedWarrants.push({
                symbol: item.INSTR_STKID,              
                name: item.INSTR_NAME,                 
                days: parseInt(item.LAST_DAYS),        
                moneyness: parseFloat(item.IN_OUT_PERCENT), 
                bid: parseFloat(item.BID1_PRICE || 0),      
                ask: parseFloat(item.ASK1_PRICE || 0),      
                lev: parseFloat(item.LEVERAGE || 0),        
                delta: parseFloat(item.DELTA || 0),         
                iv: parseFloat(item.ASK_IMP_VOL || 0)       
            });
        }
        return formattedWarrants;
    } catch (error) {
        throw error;
    }
}

/**
 * 演算法過濾邏輯
 */
function filterWarrants(warrants, mode) {
    let passed = [];

    warrants.forEach(w => {
        if (!w.ask || w.ask <= 0 || !w.bid || w.bid <= 0 || !w.lev || w.lev <= 0) return;

        let dlr = ((w.ask - w.bid) / w.ask) / w.lev;

        // 條件設定 (可根據你的喜好微調)
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

// API 端點
app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

    try {
        const rawWarrants = await fetchRealTimeWarrants(stock);
        const results = filterWarrants(rawWarrants, mode || 'swing');
        res.json({ target: stock, mode, count: results.length, data: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 重要：Vercel 專用輸出，請確保沒有 app.listen()
module.exports = app;
