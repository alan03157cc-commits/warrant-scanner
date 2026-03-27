const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const STOCK_MAP = { 
    '2330': '11467', '2317': '11475', '2454': '11478', '2492': '11472',
    '2603': '11487', '0050': '11460', '0056': '11476', '2303': '11465',
    '3231': '11512', '2382': '11484', '2308': '11470', '2618': '11491',
    '2609': '11488', '2881': '11503', '2882': '11504', '2886': '11508'
};

app.get('/api/warrants', async (req, res) => {
    const { stock, type } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少標的代號' });

    // --- 來源 1: 凱基 KGI ---
    const kgiId = STOCK_MAP[stock];
    if (kgiId) {
        try {
            const apiUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
            const params = JSON.stringify({
                "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
                "STRIKE_FROM": -1, "STRIKE_TO": -1, "VOLUME": -1,
                "UND_INSTR_INSNBR": kgiId, "CP": type || "ALL",
                "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
            });
            const response = await axios.post(apiUrl, qs.stringify({ serviceId: 'S0600013_GetWarrants', parametersOfJson: params }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
                timeout: 4000
            });
            const jsonStr = response.data.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
            if (jsonStr && jsonStr[1]) {
                const data = JSON.parse(jsonStr[1]);
                if (data.length > 0) return res.json({ stat: 'OK', data: data.map(d => [
                    d.INSTR_STKID, d.INSTR_NAME, d.STRIKE_PRICE || '0', d.EXPIRE_DATE || '',
                    d.LAST_DAYS.toString(), '0', '0', d.BID1_PRICE || '0', d.ASK1_PRICE || '0',
                    d.PRICE || '0', '1', '2', '3', '4', '5', d.IN_OUT_PERCENT || '0',
                    d.DELTA || '0', d.BID_IMP_VOL || '0', d.LEVERAGE || '0', '0'
                ])});
            }
        } catch (e) {}
    }

    // --- 來源 2: 群益 Capital (新備援) ---
    try {
        const cp = type === 'P' ? '1' : '0';
        const capUrl = `https://warrant.capital.com.tw/EDWS/GetService.asmx/GetService`;
        const capParams = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0, "UND_INSTR_STKID": stock, "CP": type || "ALL",
            "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
        });
        const capResp = await axios.post(capUrl, qs.stringify({ serviceId: 'S0600013_GetWarrants', parametersOfJson: capParams }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
            timeout: 4000
        });
        const capMatch = capResp.data.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (capMatch && capMatch[1]) {
            const data = JSON.parse(capMatch[1]);
            if (data.length > 0) return res.json({ stat: 'OK', data: data.map(d => [
                d.INSTR_STKID, d.INSTR_NAME, d.STRIKE_PRICE || '0', d.EXPIRE_DATE || '',
                d.LAST_DAYS.toString(), '0', '0', d.BID1_PRICE || '0', d.ASK1_PRICE || '0',
                d.PRICE || '0', '1', '2', '3', '4', '5', d.IN_OUT_PERCENT || '0',
                d.DELTA || '0', d.BID_IMP_VOL || '0', d.LEVERAGE || '0', '0'
            ])});
        }
    } catch (e) {}

    // --- 來源 3: TWSE ---
    try {
        const twseResp = await axios.get(`https://www.twse.com.tw/rwd/zh/warrant/${type === 'P' ? 'TWTBUU' : 'TWTAUU'}?response=json&stockNo=${stock}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000
        });
        if (twseResp.data && twseResp.data.data) return res.json(twseResp.data);
    } catch (e) {}

    res.json({ stat: 'FAIL', data: [], message: `查無資料。` });
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