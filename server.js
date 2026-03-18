// ... 其他部分相同

async function fetchRealTimeWarrants(stockCode) {
    try {
        const searchUrl = `https://www.warrantwin.com.tw/eyuanta/Warrant/Search.aspx?SID=${stockCode.trim()}`;

        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'Referer': 'https://www.warrantwin.com.tw/eyuanta/'
            },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);
        const warrants = [];

        // 找所有權證連結作為起點
        $('a[href*="Info.aspx?WID="]').each((i, el) => {
            const linkText = $(el).text().trim(); // e.g. [030205]
            if (!linkText.startsWith('[')) return;

            const codeMatch = linkText.match(/\[(\d+)\]/);
            const symbol = codeMatch ? codeMatch[1] : '';

            // 找後續文字（兄弟節點或 parent 文字）
            let sibling = $(el).parent().contents().filter(function() { return this.type === 'text'; });
            let rawText = sibling.text().trim().replace(/\s+/g, ' ');

            // 解析 rawText，例如: 台積電元大53購03 6.85 -0.35 -4.86 1 1330.85 0.0120 13 43.14%價內 4.86 3.17 -- 7.45
            const parts = rawText.split(' ').filter(p => p);

            if (parts.length < 10) return;

            const name = parts[0];
            const lastPrice = parseFloat(parts[1]) || 0;
            const daysIndex = 8; // 調整位置，剩餘天數通常在固定偏移
            const days = parseInt(parts[daysIndex]) || 0;

            let moneynessStr = parts.find(p => p.includes('%價內') || p.includes('%價外')) || '';
            let moneyness = parseFloat(moneynessStr.replace(/[^0-9.-]/g, '')) || 0;
            if (moneynessStr.includes('價外')) moneyness = -moneyness;

            const levIndex = parts.findIndex(p => p.includes('實質槓桿')) + 1 || 11;
            const lev = parseFloat(parts[levIndex]) || 0;

            const iv = parseFloat(parts.find(p => p.includes('隱波'))?.replace('--', '0') || '0') || 0;

            // bid/ask：頁面預設沒分開，用 lastPrice fallback
            const bid = lastPrice * 0.99 || 0; // 粗估
            const ask = lastPrice * 1.01 || 0;

            if (symbol && days > 0 && lev > 0) {
                warrants.push({
                    symbol,
                    name,
                    days,
                    moneyness,
                    bid,
                    ask,
                    lev,
                    delta: 0,
                    iv
                });
            }
        });

        if (warrants.length === 0) {
            throw new Error(`元大無 ${stockCode} 權證，或解析失敗 (檢查頁面是否有資料)`);
        }

        return warrants;
    } catch (error) {
        console.error('元大 fetch 失敗:', error.message, error.stack);
        throw new Error('元大資料載入失敗：' + error.message);
    }
}

// filterWarrants 保持原樣
