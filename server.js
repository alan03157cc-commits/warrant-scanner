const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/warrants', async (req, res) => {
    const { stock, type, debug } = req.query;
    if (!stock) return res.status(400).json({ error: '缺少代碼' });

    let errors = [];

    // --- 來源 1: 凱基 KGI (自動偵測模式) ---
    try {
        const findIdUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
        const findIdResp = await axios.post(findIdUrl, `serviceId=S0600013_GetUnderlyingAutoComplete&parametersOfJson=${encodeURIComponent(JSON.stringify({ "KeyWord": stock }))}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
            timeout: 3000
        });
        const match = findIdResp.data.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
        if (match && match[1]) {
            const undData = JSON.parse(match[1]);
            const targetId = undData[0]?.ID;
            if (targetId) {
                const getWrtResp = await axios.post(findIdUrl, `serviceId=S0600013_GetWarrants&parametersOfJson=${encodeURIComponent(JSON.stringify({ "NORMAL_OR_CATTLE_BEAR":0, "UND_INSTR_INSNBR": targetId, "CP": type || "ALL", "LocationPathName": "/edwebsite/views/warrantsearch/warrantsearch.aspx" }))}`, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
                    timeout: 4000
                });
                const wrtMatch = getWrtResp.data.match(/<ValueOfJson>(.*?)<\/ValueOfJson>/);
                if (wrtMatch && wrtMatch[1]) {
                    const data = JSON.parse(wrtMatch[1]);
                    if (data.length > 0) return res.json({ stat: 'OK', source: 'KGI', data: data.map(d => [
                        d.INSTR_STKID, d.INSTR_NAME, d.STRIKE_PRICE || '0', '', d.LAST_DAYS.toString(), '0', '0', d.BID1_PRICE || '0', d.ASK1_PRICE || '0',
                        d.PRICE || '0', '0', '0', '0', '0', '0', d.IN_OUT_PERCENT || '0', '0', '0', d.LEVERAGE || '0', '0'
                    ])});
                }
            }
        }
    } catch (e) { errors.push(`KGI: ${e.message}`); }

    // --- 來源 2: MoneyDJ 爬蟲 ---
    try {
        const url = `https://www.moneydj.com/Z/ZK/ZK001/ZK001_${stock}.djhtm`;
        const resp = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
        const $ = cheerio.load(resp.data);
        const data = [];
        $('table.t10 tr').each((i, row) => {
            if (i < 1) return;
            const cols = $(row).find('td');
            if (cols.length < 10) return;
            const name = $(cols[0]).text().trim();
            const code = name.match(/\d+/)?.[0] || '';
            const price = $(cols[1]).text().trim();
            const strike = $(cols[3]).text().trim();
            const inOut = $(cols[4]).text().trim();
            const lev = $(cols[6]).text().trim();
            const days = $(cols[8]).text().trim();
            const typeStr = $(cols[10]).text().trim();
            if (type && typeStr !== (type === 'P' ? '認售' : '認購')) return;
            data.push([code, name, strike, '', days, '0', '0', price, price, price, '0', '0', '0', '0', '0', inOut, '0', '0', lev, '0']);
        });
        if (data.length > 0) return res.json({ stat: 'OK', source: 'MoneyDJ', data: data });
    } catch (e) { errors.push(`MoneyDJ: ${e.message}`); }

    // --- 來源 3: 證交所 TWSE (最後防線) ---
    try {
        const twseUrl = `https://www.twse.com.tw/rwd/zh/warrant/${type === 'P' ? 'TWTBUU' : 'TWTAUU'}?response=json&stockNo=${stock}`;
        const twseResp = await axios.get(twseUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
        if (twseResp.data && twseResp.data.data && twseResp.data.data.length > 0) {
            return res.json({ ...twseResp.data, source: 'TWSE' });
        }
    } catch (e) { errors.push(`TWSE: ${e.message}`); }

    // Debug 模式回傳錯誤詳情
    if (debug === 'true') {
        return res.json({ stat: 'FAIL', errors: errors, stock: stock, note: '這表示所有後端檢索來源目前都回傳空值或連線失敗。' });
    }

    res.json({ stat: 'FAIL', data: [], message: `查無資料。(${errors.length} 來源失敗)` });
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ 權證掃描後端啟動: http://localhost:${PORT}`);
    });
}