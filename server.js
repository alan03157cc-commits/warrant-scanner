const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 全面內建 KGI 與 TWSE 相容代碼
const STOCK_MAP = {
    '2330': '11467', '2317': '11475', '2454': '11478', '2492': '11472',
    '2603': '11487', '0050': '11460', '0056': '11476', '2303': '11465',
    '2609': '11488', '2881': '11503', '2882': '11504', '2382': '11484',
    '3231': '11512', '2409': '11477', '3481': '11514', '2376': '11482'
};

app.get('/api/warrants', async (req, res) => {
    const { stock, type } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少代碼' });

    // 備案 1: 凱基 KGI (通常在 Vercel 較穩定)
    const kgiId = STOCK_MAP[stock];
    if (kgiId) {
        try {
            const apiUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
            const params = JSON.stringify({
                "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
                "STRIKE_FROM": -1, "STRIKE_TO": -1, "VOLUME": -1,
                "UND_INSTR_INSNBR": kgiId, 
                "LAST_DAYS_FROM": -1, "LAST_DAYS_TO": -1, "IMP_VOL": -1, "CP": type || "ALL",
                "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
            });

            const response = await axios.post(apiUrl, qs.stringify({ serviceId: 'S0600013_GetWarrants', parametersOfJson: params }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
                timeout: 5000
            });

            const content = response.data;
            const jsonStr = content.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
            if (jsonStr && jsonStr[1]) {
                const data = JSON.parse(jsonStr[1]);
                if (data.length > 0) {
                    const converted = data.map(d => [
                        d.INSTR_STKID, d.INSTR_NAME, d.STRIKE_PRICE || '0', d.EXPIRE_DATE || '',
                        d.LAST_DAYS.toString(), '0', '0', d.BID1_PRICE || d.PRICE || '0', d.ASK1_PRICE || d.PRICE || '0',
                        d.PRICE || '0', '0', '0', '0', '0', '0', d.IN_OUT_PERCENT || '0',
                        d.DELTA || '0', d.BID_IMP_VOL || '0', d.LEVERAGE || '0', '0'
                    ]);
                    console.log(`[Proxy] KGI Match for ${stock}: ${data.length} items.`);
                    return res.json({ stat: 'OK', data: converted });
                }
            }
        } catch (e) {
            console.error('[KGI Engine Failed]', e.message);
        }
    }

    // 備案 2: 證交所 TWSE (Fallback)
    try {
        const twseType = type === 'P' ? 'TWTBUU' : 'TWTAUU';
        const twseUrl = `https://www.twse.com.tw/rwd/zh/warrant/${twseType}?response=json&stockNo=${stock}`;
        const twseResp = await axios.get(twseUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000
        });
        if (twseResp.data && twseResp.data.data) {
            console.log(`[Proxy] TWSE Match for ${stock}: ${twseResp.data.data.length} items.`);
            return res.json(twseResp.data);
        }
    } catch (e) {
        console.error('[TWSE Engine Failed]', e.message);
    }

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