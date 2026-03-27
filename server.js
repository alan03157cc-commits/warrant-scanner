const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 凱基標的 Mapping
const kgiMap = {
    '2330': '11467', '2317': '11475', '2454': '11478', '2492': '11472',
    '2603': '11487', '0050': '11460', '0056': '11476', '2303': '11465',
    '2609': '11488', '2881': '11503', '2882': '11504', '2382': '11484'
};

// 代理路由：雙引擎備援模式
app.get('/api/warrants', async (req, res) => {
    const { stock, type } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少標代號' });

    // --- 嘗試來源 1: 證交所 (TWSE) ---
    try {
        const apiPath = type === 'P' ? 'TWTBUU' : 'TWTAUU';
        const twseUrl = `https://www.twse.com.tw/rwd/zh/warrant/${apiPath}?response=json&stockNo=${stock}`;
        
        const twseResp = await axios.get(twseUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://www.twse.com.tw/zh/page/warrant/TWTAUU.html'
            },
            timeout: 5000
        });

        if (twseResp.data && twseResp.data.data && twseResp.data.data.length > 0) {
            console.log(`[Source] TWSE Success for ${stock}`);
            return res.json(twseResp.data);
        }
    } catch (e) {
        console.warn(`[TWSE Failed] ${stock}: ${e.message}`);
    }

    // --- 嘗試來源 2: 凱基 (KGI) + 格式轉換 ---
    try {
        const kgiId = kgiMap[stock];
        if (kgiId) {
            const kgiUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
            const kgiParams = JSON.stringify({
                "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
                "STRIKE_FROM": -1, "STRIKE_TO": -1, "VOLUME": -1,
                "UND_INSTR_INSNBR": kgiId, 
                "LAST_DAYS_FROM": -1, "LAST_DAYS_TO": -1, "IMP_VOL": -1, "CP": type || "ALL",
                "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
            });

            const kgiResp = await axios.post(kgiUrl, qs.stringify({ serviceId: 'S0600013_GetWarrants', parametersOfJson: kgiParams }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
                timeout: 5000
            });

            const xml = kgiResp.data;
            const jsonPart = xml.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
            if (jsonPart && jsonPart[1]) {
                const kgiData = JSON.parse(jsonPart[1]);
                if (kgiData && kgiData.length > 0) {
                    console.log(`[Source] KGI Success for ${stock}`);
                    // 轉為 TWSE 陣列格式
                    const converted = kgiData.map(d => [
                        d.INSTR_STKID, d.INSTR_NAME, d.STRIKE_PRICE || '0', d.EXPIRE_DATE || '',
                        d.LAST_DAYS.toString(), '0', '0', d.BID1_PRICE || '0', d.ASK1_PRICE || '0',
                        d.BID1_PRICE || '0', '0', '0', '0', '0', '0', d.IN_OUT_PERCENT || '0',
                        d.DELTA || '0', d.BID_IMP_VOL || '0', d.LEVERAGE || '0', '0'
                    ]);
                    return res.json({ stat: 'OK', data: converted });
                }
            }
        }
    } catch (e) {
        console.warn(`[KGI Failed] ${stock}: ${e.message}`);
    }

    // --- 通通失敗 ---
    res.json({ stat: 'FAIL', data: [], message: `目前標的 ${stock} 無即時權證資料或連線異常。` });
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