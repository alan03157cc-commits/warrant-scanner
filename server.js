const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 全域記憶體快取：只在伺服器甦醒時抓一次清單，之後搜尋都是秒查
let globalStockCache = null;

/**
 * 🕵️‍♂️ 核心破解引擎：偽裝成真實瀏覽器，動態抓取凱基全市場標的清單
 */
async function fetchDynamicStockList() {
    const url = 'https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList';
    // 偽裝標頭：讓凱基以為這是一台正常的 Windows 電腦在瀏覽
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
        'Referer': 'https://warrant.kgi.com/edwebsite/views/warrantsearch/warrantsearch.aspx',
        'Origin': 'https://warrant.kgi.com',
        'Connection': 'keep-alive'
    };

    try {
        // 嘗試 1：用常規的 POST 請求敲門
        const res = await axios.post(url, {}, { headers, timeout: 8000 });
        if (res.data && Array.isArray(res.data)) return res.data;
        throw new Error("POST 格式不符");
    } catch (err1) {
        console.log("POST 被擋或失敗，啟動 GET 備用方案...");
        try {
            // 嘗試 2：如果 POST 報 404，立刻改用 GET 請求繞過防火牆
            const res2 = await axios.get(url, { headers, timeout: 8000 });
            if (res2.data && Array.isArray(res2.data)) return res2.data;
            throw new Error("GET 格式不符");
        } catch (err2) {
            throw new Error("無法突破凱基防火牆取得清單，請稍後再試。");
        }
    }
}

/**
 * 自動轉換器：輸入任何代號，自動在動態清單中找尋凱基內部 ID
 */
async function getInternalId(stockCode) {
    stockCode = stockCode.trim();
    
    // 如果大腦裡沒有清單，立刻去抓一份最新的回來
    if (!globalStockCache) {
        console.log("正在動態下載全市場標的清單...");
        globalStockCache = await fetchDynamicStockList();
        console.log(`✅ 下載成功！共取得 ${globalStockCache.length} 檔標的資料。`);
    }
    
    // 翻找對應的內部 ID
    const match = globalStockCache.find(item => item.UnderlyingId.trim() === stockCode);
    return match ? match.UnderlyingInsnbr : null;
}

// --- API 請求端點 ---
app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

    try {
        // 1. 動態取得凱基 ID (完全依賴你輸入的代碼)
        const internalId = await getInternalId(stock);
        
        if (!internalId) {
            throw new Error(`找不到股票代號 ${stock}，請確認這檔股票「目前」是否有發行權證。`);
        }

        // 2. 拿著動態抓到的 ID 去要權證資料
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

        const response = await axios.post('https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService', requestData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://warrant.kgi.com/edwebsite/views/warrantsearch/warrantsearch.aspx'
            },
            timeout: 10000
        });

        const xmlText = response.data;
        const jsonMatch = xmlText.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (!jsonMatch || !jsonMatch[1]) throw new Error('目前查無報價，或是該標的權證已全數下市。');

        const rawData = JSON.parse(jsonMatch[1]);
        const formattedWarrants = rawData.map(item => ({
            symbol: item.INSTR_STKID,              
            name: item.INSTR_NAME,                 
            days: parseInt(item.LAST_DAYS),        
            moneyness: parseFloat(item.IN_OUT_PERCENT), 
            bid: parseFloat(item.BID1_PRICE || 0),      
            ask: parseFloat(item.ASK1_PRICE || 0),      
            lev: parseFloat(item.LEVERAGE || 0),        
            delta: parseFloat(item.DELTA || 0)     
        }));

        const results = formattedWarrants.filter(w => {
            if (!w.ask || w.ask <= 0 || !w.bid || w.bid <= 0 || !w.lev || w.lev <= 0) return false;
            let dlr = ((w.ask - w.bid) / w.ask) / w.lev;

            if (mode === 'short') {
                return w.days >= 30 && dlr <= 0.0015;
            } else {
                return w.days >= 60 && dlr <= 0.0020;
            }
        })
        .sort((a, b) => (((a.ask - a.bid) / a.ask) / a.lev) - (((b.ask - b.bid) / b.ask) / b.lev))
        .slice(0, 10);

        res.json({ target: stock, mode, count: results.length, data: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;
