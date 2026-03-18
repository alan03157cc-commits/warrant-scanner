const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let internalCodeCache = null;

// 自動取得凱基內部的股票 ID 對應表
async function getInternalId(targetStock) {
    try {
        if (!internalCodeCache) {
            const response = await axios.post('https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList', 
            {}, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://warrant.kgi.com/edwebsite/views/warrantsearch/warrantsearch.aspx'
                }
            });
            internalCodeCache = response.data;
        }
        const match = internalCodeCache.find(item => item.UnderlyingId.trim() === targetStock.trim());
        if (match) return match.UnderlyingInsnbr;
        throw new Error(`找不到代號 ${targetStock}，請確認該股是否有權證。`);
    } catch (error) {
        throw error;
    }
}

async function fetchRealTimeWarrants(stockCode) {
    try {
        const internalId = await getInternalId(stockCode);
        const apiUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
        const parametersOfJson = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
            "UND_INSTR_INSNBR": internalId, 
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
        if (!jsonMatch || !jsonMatch[1]) throw new Error('解析失敗或目前無權證資料');

        const rawData = JSON.parse(jsonMatch[1]);
        return rawData.map(item => ({
            symbol: item.INSTR_STKID,              
            name: item.INSTR_NAME,                 
            days: parseInt(item.LAST_DAYS),        
            moneyness: parseFloat(item.IN_OUT_PERCENT), 
            bid: parseFloat(item.BID1_PRICE || 0),      
            ask: parseFloat(item.ASK1_PRICE || 0),      
            lev: parseFloat(item.LEVERAGE || 0),        
            delta: parseFloat(item.DELTA || 0),         
            iv: parseFloat(item.ASK_IMP_VOL || 0)       
        }));
    } catch (error) { throw error; }
}

function filterWarrants(warrants, mode) {
    let passed = [];
    warrants.forEach(w => {
        if (!w.ask || w.ask <= 0 || !w.bid || w.bid <= 0 || !w.lev || w.lev <= 0) return;
        let dlr = ((w.ask - w.bid) / w.ask) / w.lev;

        if (mode === 'short') {
            if (w.days < 30 || Math.abs(w.moneyness) > 5 || w.delta < 0.5 || dlr > 0.0015) return; 
        } else {
            if (w.days < 60 || Math.abs(w.moneyness) > 10 || w.delta < 0.4 || dlr > 0.0020) return; 
        }
        passed.push({ ...w, dlr_percent: (dlr * 100).toFixed(2) + '%', score: 100 - (dlr * 10000) });
    });
    return passed.sort((a, b) => b.score - a.score).slice(0, 10);
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    try {
        const raw = await fetchRealTimeWarrants(stock);
        const results = filterWarrants(raw, mode);
        res.json({ data: results });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = app;
