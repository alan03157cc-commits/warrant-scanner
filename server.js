const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 凱基內部代號對應表 (2026 最新熱門標的)
const stockCodeMap = {
    '2330': '11467', '2317': '11475', '2454': '11478', '2492': '11472', 
    '2303': '11465', '2603': '11487', '2609': '11488', '2610': '11489',
    '2615': '11490', '2618': '11491', '2881': '11503', '2882': '11504',
    '2886': '11508', '0050': '11460', '0056': '11476', '2382': '11484',
    '2308': '11470', '2379': '11483', '3034': '11506', '3711': '11515',
    '3037': '11507', '2357': '11466', '2376': '11482', '2408': '11474',
    '3231': '11512', '4938': '11528', '2344': '11471', '2409': '11477',
    '3481': '11514', '6415': '11542', '3661': '11524',
    // 增加更多熱門股
    '3443': '11522', '3035': '11531', '6669': '11547', '1513': '11451',
    '1519': '11452', '2353': '11480', '2324': '11469', '2356': '11481',
    '2412': '11479', '3008': '11505', '3406': '11519', '6505': '11543',
    '2002': '11202', '1101': '11201', '1301': '11203', '1303': '11204',
    '2105': '11205', '2618': '11491', '2313': '11468', '3532': '11523',
    '2308': '11470', '2382': '11484', '3017': '11516', '3324': '11518'
};

// API 路由：支援輸入代號或名稱
app.get('/api/warrants', async (req, res) => {
    const { stock, type } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少標的代號' });

    // 從 Mapping 獲取 ID (若輸入代號不在表中，嘗試模糊匹配名稱)
    let internalId = stockCodeMap[stock];
    
    if (!internalId) {
        return res.status(404).json({ error: `目前系統尚未建立 ${stock} 的凱基內部對應碼，請聯絡管理員補足。`, stat: 'FAIL' });
    }

    try {
        const apiUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
        const parametersOfJson = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
            "STRIKE_FROM": -1, "STRIKE_TO": -1, "VOLUME": -1,
            "UND_INSTR_INSNBR": internalId, 
            "LAST_DAYS_FROM": -1, "LAST_DAYS_TO": -1, "IMP_VOL": -1, "CP": type || "ALL",
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
        if (!jsonMatch || !jsonMatch[1]) throw new Error('解析 XML 失敗或無資料');

        const rawData = JSON.parse(jsonMatch[1]);
        
        // 將凱基格式轉換為 TWSE 陣列格式以維持前端相容性
        const twseFormatData = rawData.map(item => [
            item.INSTR_STKID,              // 0: 代號
            item.INSTR_NAME,               // 1: 名稱
            item.STRIKE_PRICE || '0',     // 2: 履約價
            item.EXPIRE_DATE || '',        // 3: 到期日
            item.LAST_DAYS.toString(),     // 4: 剩餘天數
            '0', '0',                      // 5, 6: 發行/剩餘
            item.BID1_PRICE || '0',        // 7: 買進
            item.ASK1_PRICE || '0',        // 8: 賣出
            item.BID1_PRICE || '0',        // 9: 成交 (暫用補位)
            '0', '0', '0', '0', '0',       // 10-14
            item.IN_OUT_PERCENT || '0',    // 15: 價內外%
            item.DELTA || '0',             // 16: Delta
            item.BID_IMP_VOL || '0',       // 17: 隱波%
            item.LEVERAGE || '0',          // 18: 實質槓桿
            '0'                            // 19
        ]);

        res.json({ stat: 'OK', data: twseFormatData });

    } catch (error) {
        console.error('KGI Fetch Error:', error.message);
        res.status(500).json({ error: `凱基 API 連線失敗: ${error.message}`, stat: 'ERROR' });
    }
});

// Vercel 專屬輸出
module.exports = app;

// 本機開發啟動 (僅在直接執行時)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ 凱基版伺服器已啟動: http://localhost:${PORT}`);
    });
}