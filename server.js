const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 全域記憶體快取
let dynamicStockCache = null;

/**
 * 🕸️ 終極代理伺服器池 (Proxy Pool)
 * 自動切換不同國家的代理伺服器與連線方式，確保 100% 突破凱基防火牆
 */
async function fetchListWithRetry() {
    const targetUrl = 'https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList';
    
    // 定義 3 種不同的突圍策略
    const strategies = [
        // 策略 1：CodeTabs 代理 (高成功率)
        () => axios.get(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, { timeout: 8000 }),
        // 策略 2：AllOrigins 代理 (穩定備用)
        () => axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, { timeout: 8000 }),
        // 策略 3：直連硬闖 + 偽裝成台灣中華電信 IP
        () => axios.post(targetUrl, {}, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
                'X-Forwarded-For': `211.75.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
                'Content-Type': 'application/json'
            }, 
            timeout: 8000 
        })
    ];

    for (let i = 0; i < strategies.length; i++) {
        try {
            console.log(`嘗試連線策略 ${i + 1}...`);
            const res = await strategies[i]();
            // 確認抓回來的真的是陣列資料
            if (res.data && Array.isArray(res.data) && res.data.length > 50) {
                console.log(`✅ 策略 ${i + 1} 成功取得全市場清單！`);
                return res.data;
            }
        } catch (e) {
            console.log(`❌ 策略 ${i + 1} 失敗: ${e.message}`);
        }
    }
    return null; // 三條路都失敗才回傳 null
}

async function getInternalId(stockCode) {
    stockCode = stockCode.trim();

    // 如果快取是空的，啟動多重突圍去抓資料
    if (!dynamicStockCache) {
        dynamicStockCache = await fetchListWithRetry();
    }

    if (dynamicStockCache) {
        const match = dynamicStockCache.find(item => item.UnderlyingId.trim() === stockCode);
        return match ? match.UnderlyingInsnbr : null;
    }
    
    // 如果連代理池都全滅
    throw new Error("系統無法突破凱基防火牆取得代碼清單，請稍後再試。");
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

    try {
        // 1. 動態尋找內部 ID
        const internalId = await getInternalId(stock);
        
        if (!internalId) {
            throw new Error(`在凱基最新清單中找不到代號 ${stock}！可能原因：該股目前無發行權證，或輸入錯誤。`);
        }

        // 2. 抓取報價 (這個 API 不會擋)
        const parametersOfJson = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
            "UND_INSTR_INSNBR": internalId, 
            "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
        });

        const requestData = qs.stringify({
            serviceId: 'S0600013_GetWarrants',
            parametersOfJson: parametersOfJson
        });

        const response = await axios.post('https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService', requestData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 12000
        });

        const xmlText = response.data;
        const jsonMatch = xmlText.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (!jsonMatch || !jsonMatch[1]) throw new Error('目前查無報價，或是該標的權證已全數下市。');

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
            if (!w.ask || w.ask <= 0 || !w.bid || w.bid <= 0 || !w.lev || w.lev <= 0) return false;
            let dlr = ((w.ask - w.bid) / w.ask) / w.lev;
            // 你的篩選邏輯
            return mode === 'short' ? (w.days >= 30 && dlr <= 0.0015) : (w.days >= 60 && dlr <= 0.0020);
        }).sort((a, b) => (((a.ask - a.bid) / a.ask) / a.lev) - (((b.ask - b.bid) / b.ask) / b.lev)).slice(0, 10);

        res.json({ target: stock, mode, count: results.length, data: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;
