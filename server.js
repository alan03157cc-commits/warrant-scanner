const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qs = require('qs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 全域快取：Underlying 清單 + 最後更新時間
let internalCodeCache = null;
let lastCacheUpdate = 0;
const CACHE_REFRESH_INTERVAL = 60 * 60 * 1000; // 每小時強制刷新一次

/**
 * 取得凱基內部 Underlying ID（帶自動刷新與 retry）
 * @param {string} targetStock - 使用者輸入的股票代號，如 '2330'
 * @returns {Promise<string|null>} UnderlyingInsnbr 或 null
 */
async function getInternalId(targetStock) {
    targetStock = targetStock.trim();

    const now = Date.now();
    const shouldRefresh = !internalCodeCache || (now - lastCacheUpdate > CACHE_REFRESH_INTERVAL);

    if (shouldRefresh) {
        console.log(`[${new Date().toISOString()}] 刷新 Underlying 清單...`);
        try {
            const response = await axios.post(
                'https://warrant.kgi.com/edwebsite/api/WarrantSearch/GetUnderlyingList',
                {},
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
                        'Origin': 'https://warrant.kgi.com',
                        'Referer': 'https://warrant.kgi.com/edwebsite/views/warrantsearch/warrantsearch.aspx',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Connection': 'keep-alive'
                    },
                    timeout: 10000
                }
            );

            if (Array.isArray(response.data)) {
                internalCodeCache = response.data;
                lastCacheUpdate = now;
                console.log(`清單刷新成功，共有 ${internalCodeCache.length} 筆標的`);
            } else {
                throw new Error('回傳格式非陣列');
            }
        } catch (err) {
            console.error('GetUnderlyingList 失敗:', err.message);
            // 如果失敗，不拋錯，讓後續用舊 cache（如果有）
        }
    }

    if (!internalCodeCache) {
        throw new Error('無法載入 Underlying 清單，可能 API 被阻擋或網路問題');
    }

    const match = internalCodeCache.find(
        item => item.UnderlyingId && item.UnderlyingId.trim() === targetStock
    );

    if (match && match.UnderlyingInsnbr) {
        return match.UnderlyingInsnbr;
    }

    // 找不到 → 強制再刷新一次（最多一次，避免無限迴圈）
    if (!shouldRefresh) {
        console.log(`找不到 ${targetStock}，強制再刷新一次清單...`);
        internalCodeCache = null;
        lastCacheUpdate = 0;
        return await getInternalId(targetStock);
    }

    throw new Error(`找不到股票 ${targetStock} 的內部 ID。可能原因：1. 凱基未發行該股權證 2. 該股太冷門 3. API 變更`);
}

/**
 * 抓取即時權證資料
 */
async function fetchRealTimeWarrants(stockCode) {
    const internalId = await getInternalId(stockCode);

    const apiUrl = 'https://warrant.kgi.com/EDWebService/WSInterfaceSwap.asmx/GetService';
    const parametersOfJson = JSON.stringify({
        NORMAL_OR_CATTLE_BEAR: 0,
        INSWRT_ISSUER_NAME: "ALL",
        STRIKE_FROM: -1,
        STRIKE_TO: -1,
        VOLUME: -1,
        UND_INSTR_INSNBR: internalId,
        LAST_DAYS_FROM: -1,
        LAST_DAYS_TO: -1,
        IMP_VOL: -1,
        CP: "ALL",
        IN_OUT_PERCENT_FROM: -1,
        IN_OUT_PERCENT_TO: -1,
        BID_ASK_SPREAD_PERCENT: -1,
        LEVERAGE: -1,
        EXECRATE: -1,
        OUTSTANDING_PERCENT: -1,
        BARRIER_DEAL_PERCENT: -1,
        LocationPathName: "/edwebsite/views/warrantsearch/warrantsearch.aspx"
    });

    const requestData = qs.stringify({
        serviceId: 'S0600013_GetWarrants',
        parametersOfJson
    });

    const response = await axios.post(apiUrl, requestData, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            'Referer': 'https://warrant.kgi.com/edwebsite/views/warrantsearch/warrantsearch.aspx'
        },
        timeout: 15000
    });

    const xmlText = response.data;
    const jsonMatch = xmlText.match(/<ValueOfJson>([\s\S]*?)<\/ValueOfJson>/);
    if (!jsonMatch || !jsonMatch[1]) {
        throw new Error('無法解析權證資料，該標的可能無有效權證或 API 格式變更');
    }

    const rawData = JSON.parse(jsonMatch[1]);

    return rawData.map(item => ({
        symbol: item.INSTR_STKID || '',
        name: item.INSTR_NAME || '',
        days: parseInt(item.LAST_DAYS) || 0,
        moneyness: parseFloat(item.IN_OUT_PERCENT) || 0,
        bid: parseFloat(item.BID1_PRICE) || 0,
        ask: parseFloat(item.ASK1_PRICE) || 0,
        lev: parseFloat(item.LEVERAGE) || 0,
        delta: parseFloat(item.DELTA) || 0,
        iv: parseFloat(item.ASK_IMP_VOL || item.IMP_VOL) || 0
    }));
}

/**
 * 過濾權證（極短線 / 波段）
 */
function filterWarrants(warrants, mode = 'swing') {
    const passed = warrants
        .filter(w => {
            if (w.days <= 0 || w.ask <= 0 || w.bid <= 0 || w.lev <= 0) return false;

            const spread = (w.ask - w.bid) / w.ask;
            const dlr = spread / w.lev;

            if (mode === 'short') {
                // 極短線
                return (
                    w.days >= 30 &&
                    w.days <= 120 && // 避免太長
                    w.moneyness >= -5 && w.moneyness <= 5 &&
                    w.delta >= 0.5 && w.delta <= 0.8 &&
                    dlr <= 0.0015
                );
            } else {
                // 波段（預設）
                return (
                    w.days >= 60 &&
                    w.days <= 180 &&
                    w.moneyness >= -10 && w.moneyness <= 5 &&
                    w.delta >= 0.4 && w.delta <= 0.6 &&
                    dlr <= 0.0020
                );
            }
        })
        .map(w => {
            const spread = (w.ask - w.bid) / w.ask;
            const dlr = spread / w.lev;
            return {
                ...w,
                dlr_percent: (dlr * 100).toFixed(3) + '%',
                score: Math.round(100 - dlr * 15000) // 調整權重，讓低 dlr 更突出
            };
        });

    return passed.sort((a, b) => b.score - a.score).slice(0, 10);
}

// 主 API
app.get('/api/warrants', async (req, res) => {
    const { stock, mode } = req.query;
    if (!stock) {
        return res.status(400).json({ error: '請提供股票代號，例如 ?stock=2330' });
    }

    try {
        const raw = await fetchRealTimeWarrants(stock);
        const filtered = filterWarrants(raw, mode);
        res.json({
            target: stock,
            mode: mode || 'swing',
            count: filtered.length,
            data: filtered
        });
    } catch (err) {
        console.error('API 錯誤:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;
