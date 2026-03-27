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
    if (!stock) return res.status(400).json({ error: '缺少代碼' });

    try {
        // --- 1. 自動偵測標的 KGI 內部 ID ---
        const findIdUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
        const findIdParams = JSON.stringify({ "KeyWord": stock });
        const findIdResp = await axios.post(findIdUrl, qs.stringify({ serviceId: 'S0600013_GetUnderlyingAutoComplete', parametersOfJson: findIdParams }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000
        });
        const findIdMatch = findIdResp.data.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (!findIdMatch || !findIdMatch[1]) throw new Error(`找不到標的 ${stock} 的內部代號`);
        const undData = JSON.parse(findIdMatch[1]);
        const target = undData.find(u => u.VAL.includes(stock)) || undData[0];
        const internalId = target.ID;
        console.log(`[AutoID] ${stock} -> ${internalId} (${target.VAL})`);

        // --- 2. 使用偵測到的 ID 抓取權證 ---
        const getWrtParams = JSON.stringify({
            "NORMAL_OR_CATTLE_BEAR": 0, "INSWRT_ISSUER_NAME": "ALL",
            "STRIKE_FROM": -1, "STRIKE_TO": -1, "VOLUME": -1,
            "UND_INSTR_INSNBR": internalId, "CP": type || "ALL",
            "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx"
        });
        const getWrtResp = await axios.post(findIdUrl, qs.stringify({ serviceId: 'S0600013_GetWarrants', parametersOfJson: getWrtParams }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000
        });
        const getWrtMatch = getWrtResp.data.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (getWrtMatch && getWrtMatch[1]) {
            const data = JSON.parse(getWrtMatch[1]);
            res.json({ stat: 'OK', data: data.map(d => [
                d.INSTR_STKID, d.INSTR_NAME, d.STRIKE_PRICE || '0', d.EXPIRE_DATE || '',
                d.LAST_DAYS.toString(), '0', '0', d.BID1_PRICE || '0', d.ASK1_PRICE || '0',
                d.PRICE || '0', '0', '0', '0', '0', '0', d.IN_OUT_PERCENT || '0',
                d.DELTA || '0', d.BID_IMP_VOL || '0', d.LEVERAGE || '0', '0'
            ])});
            return;
        }
    } catch (e) {
        console.error('[KGI AutoFailed]', e.message);
    }

    // --- 備援: 證交所 (TWSE) ---
    try {
        const twseResp = await axios.get(`https://www.twse.com.tw/rwd/zh/warrant/${type === 'P' ? 'TWTBUU' : 'TWTAUU'}?response=json&stockNo=${stock}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000
        });
        if (twseResp.data && twseResp.data.data) return res.json(twseResp.data);
    } catch (e) {}

    res.json({ stat: 'FAIL', data: [], message: '伺服器連線繁忙或查無資料。' });
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