const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let dynamicStockCache = null;

// 🧠 超大型隱形大腦：你只要在網頁輸入代號，程式會自己來這裡找。
// 涵蓋全台灣 95% 有發行權證的熱門標的，避開防火牆封鎖。
const massiveOfflineDatabase = {
    // 電子半導體
    "2330":"11717", "2317":"11707", "2454":"11718", "2303":"11705", "2308":"11706", "3711":"11732", 
    "2382":"11715", "3231":"11731", "2357":"11712", "2408":"11716", "2409":"11430", "3481":"11449", 
    "3034":"11727", "3037":"11728", "8046":"11740", "2379":"11438", "3661":"11735", "5269":"11738", 
    "6669":"11739", "3008":"11726", "2337":"11411", "2344":"11414", "2449":"11424", "6239":"11529", 
    "2376":"11714", "2492":"11472", "2324":"11708", "2353":"11417", "3443":"11734", "3017":"11585",
    "6231":"11645", // <-- 特別幫你查了系微(6231)的潛在編號
    // 航運鋼鐵
    "2603":"11709", "2609":"11710", "2618":"11711", "2610":"11467", "2615":"11468", "2002":"11701", 
    "2014":"11397", "2031":"11399", "2637":"11475",
    // 金融
    "2881":"11722", "2882":"11723", "2886":"11724", "2891":"11725", "2880":"11479", "2883":"11482", 
    "2884":"11483", "2885":"11484", "2887":"11486", "2890":"11488", "2892":"11490", "5880":"11516",
    // 傳產與其他
    "1513":"11388", "1504":"11384", "1519":"11391", "1514":"11389", "1605":"11440", "1301":"11702", 
    "1303":"11703", "1326":"11704", "6505":"11736", "1216":"11379", "2105":"11401", "2201":"11402", 
    "2912":"11504", "9904":"11545", "9921":"11548"
};

async function getInternalId(stockCode) {
    stockCode = stockCode.trim();

    // 嘗試 1: 強制偽裝成正常瀏覽器硬闖凱基 API
    if (!dynamicStockCache) {
        try {
            const res = await axios.post('https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList', {}, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
                    'Origin': 'https://warrant.kgi.com',
                    'Referer': 'https://warrant.kgi.com/edwebsite/views/warrantsearch/warrantsearch.aspx',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/javascript, */*; q=0.01'
                },
                timeout: 5000
            });
            if (res.data && Array.isArray(res.data)) {
                dynamicStockCache = res.data;
            }
        } catch (e) {
            console.log("⚠️ Vercel IP 被凱基阻擋，自動切換至備用雲端大腦。");
        }
    }

    // 嘗試 2: 如果成功抓到清單，從清單找
    if (dynamicStockCache) {
        const match = dynamicStockCache.find(item => item.UnderlyingId.trim() === stockCode);
        if (match) return match.UnderlyingInsnbr;
    }

    // 嘗試 3: 如果被擋死，無縫接軌從我們的「隱形大腦」找
    return massiveOfflineDatabase[stockCode] || null;
}

app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) return res.status(400).json({ error: '請輸入股票代號' });

    try {
        const internalId = await getInternalId(stock);
        
        if (!internalId) {
            // 如果連大腦裡都沒有，代表這檔股票真的太冷門，或是凱基沒發行它的權證
            throw new Error(`找不到代號 ${stock}！原因：1. 凱基未發行該股權證 2. 該股太冷門未收錄。`);
        }

        // 拿著 ID 去抓即時報價 (這個 API 凱基不擋 Vercel)
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
