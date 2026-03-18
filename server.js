const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let dynamicStockCache = null;

// 🛡️ 備用電話簿：當凱基防火牆太嚴格時的「保命符」
// 伺服器會自動查閱，你「不需要」手動修改這裡，網頁直接輸入代號即可！
const backupPhonebook = {
    "2330": "11717", "2317": "11707", "2454": "11718", "2603": "11709",
    "2303": "11705", "2382": "11715", "3231": "11731", "2357": "11712",
    "2492": "11472", "2609": "11710", "2618": "11711", "2881": "11722", 
    "2882": "11723", "2002": "11701", "3034": "11727", "3481": "11449"
};

async function getInternalId(stockCode) {
    stockCode = stockCode.trim();

    // 嘗試 1：透過 Proxy 代理伺服器繞過 Vercel IP 封鎖，動態抓取最新清單
    if (!dynamicStockCache) {
        try {
            console.log("正在使用代理伺服器繞過凱基防火牆...");
            const targetUrl = 'https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList';
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
            
            const res = await axios.post(proxyUrl, {}, { timeout: 8000 });
            if (res.data && Array.isArray(res.data)) {
                dynamicStockCache = res.data;
                console.log("✅ 成功繞過防火牆，取得最新全市場清單！");
            }
        } catch (e) {
            console.log("⚠️ 代理伺服器失效，啟用內建備用電話簿。");
        }
    }

    // 優先從「動態抓到」的最新清單中尋找
    if (dynamicStockCache) {
        const match = dynamicStockCache.find(item => item.UnderlyingId.trim() === stockCode);
        if (match) return match.UnderlyingInsnbr;
    }

    // 如果防火牆擋死，無縫接軌使用「內建備用電話簿」
    return backupPhonebook[stockCode] || null;
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

    try {
        // 全自動尋找 ID，你完全不用插手
        const internalId = await getInternalId(stock);
        
        if (!internalId) {
            throw new Error(`找不到股票代號 ${stock}！請確認該股有發行權證，或稍後再試。`);
        }

        const parametersOfJson = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
            "UND_INSTR_INSNBR": internalId, 
            "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
        });

        // 凱基抓報價的 API 沒設防火牆，可以直接連線
        const requestData = qs.stringify({
            serviceId: 'S0600013_GetWarrants',
            parametersOfJson: parametersOfJson
        });

        const response = await axios.post('https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService', requestData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
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
            return mode === 'short' ? (w.days >= 30 && dlr <= 0.0015) : (w.days >= 60 && dlr <= 0.0020);
        }).sort((a, b) => (((a.ask - a.bid) / a.ask) / a.lev) - (((b.ask - b.bid) / b.ask) / b.lev)).slice(0, 10);

        res.json({ target: stock, mode, count: results.length, data: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;
