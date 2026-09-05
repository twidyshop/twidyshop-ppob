require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
const dbFile = path.join(__dirname, 'transactions.json');

const readDB = () => {
    try {
        if (!fs.existsSync(dbFile)) return [];
        const data = fs.readFileSync(dbFile, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
};

const saveDB = (data) => {
    const limitedData = data.slice(-50);
    fs.writeFileSync(dbFile, JSON.stringify(limitedData, null, 2));
};

let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000;

app.post('/api/get-products', async (req, res) => {
    const { brand, category } = req.body;
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;
    if (!username || !apiKey) return res.status(500).json({ message: 'API Key Digiflazz belum diset' });
    try {
        const now = Date.now();
        let data = null;
        if (cachedProducts && (now - cacheTimestamp < CACHE_DURATION)) {
            data = cachedProducts;
        } else {
            const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');
            const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/price-list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd: 'prepaid', username, sign })
            });
            const rawData = await digiflazzResponse.json();
            if (rawData.data && Array.isArray(rawData.data)) {
                data = rawData.data;
                cachedProducts = data;
                cacheTimestamp = now;
            } else {
                return res.status(400).json({ message: 'Gagal ambil data dari pusat' });
            }
        }
        let targetBrand = (brand || "").toUpperCase().replace(/[^A-Z0-9]/g, '');
        let filtered = data;
        if (targetBrand) {
            filtered = data.filter(item => {
                const b = (item.brand || "").toUpperCase();
                const c = (item.category || "").toUpperCase();
                const n = (item.product_name || "").toUpperCase();
                return b.includes(targetBrand) || c.includes(targetBrand) || n.includes(targetBrand);
            });
        }
        res.json(filtered);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

setInterval(async () => {
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;
    if (!username || !apiKey) return;

    let db = readDB();
    let updated = false;

    for (let i = 0; i < db.length; i++) {
        if ((db[i].status === 'PENDING' || db[i].status === 'DIPROSES') && db[i].order_id) {
            try {
                const sign = crypto.createHash('md5').update(username + apiKey + db[i].order_id).digest('hex');
                const checkRes = await fetch('https://api.digiflazz.com/v1/transaction', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: username,
                        buyer_sku_code: db[i].product_code,
                        customer_no: db[i].target_id,
                        ref_id: db[i].order_id,
                        sign: sign
                    })
                });
                const checkData = await checkRes.json();
                const result = checkData.data;

                if (result) {
                    if (result.status === 'Sukses' || result.status === 0) {
                        db[i].status = 'SUKSES';
                        db[i].sn = result.sn || '-';
                        updated = true;
                    } else if (result.status === 'Gagal') {
                        db[i].status = 'GAGAL';
                        db[i].sn = result.sn || '-';
                        updated = true;
                    }
                }
            } catch (err) {
                console.error(`Gagal mengecek status untuk transaksi ${db[i].order_id}:`, err);
            }
        }
    }

    if (updated) {
        saveDB(db);
    }
}, 10000);

app.get(['/api/transactions', '/api/transaction', '/api/history', '/api/riwayat'], (req, res) => {
    try {
        const db = readDB();
        return res.status(200).json(db.reverse());
    } catch (e) {
        return res.status(500).json({ message: 'Error DB' });
    }
});

app.post('/api/create-transaction', async (req, res) => {
    try {
        const { targetId, productCode, price, productName } = req.body;
        if (!targetId || !productCode) return res.status(400).json({ message: 'Data kurang' });
        
        const username = process.env.DIGIFLAZZ_USERNAME;
        const apiKey = process.env.DIGIFLAZZ_API_KEY;
        const oid = `TW_${productCode}_${Date.now()}`;
        const amt = parseInt(price || 0);
        
        let initialStatus = 'DIPROSES';
        let initialSn = '-';

        if (username && apiKey) {
            try {
                const sign = crypto.createHash('md5').update(username + apiKey + oid).digest('hex');
                const digiRes = await fetch('https://api.digiflazz.com/v1/transaction', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: username,
                        buyer_sku_code: productCode,
                        customer_no: targetId,
                        ref_id: oid,
                        sign: sign,
                        testing: false
                    })
                });
                const digiData = await digiRes.json();
                const trx = digiData.data || {};
                
                if (trx.status === 'Sukses' || trx.status === 0) {
                    initialStatus = 'SUKSES';
                    initialSn = trx.sn || '-';
                } else if (trx.status === 'Gagal') {
                    initialStatus = 'GAGAL';
                    initialSn = trx.sn || '-';
                }
            } catch (err) {
                initialStatus = 'DIPROSES';
            }
        }

        const db = readDB();
        db.push({
            order_id: oid,
            target_id: targetId,
            product_code: productCode,
            product_name: productName || 'PPOB',
            amount: amt,
            status: initialStatus,
            sn: initialSn,
            created_at: new Date().toISOString()
        });
        saveDB(db);
        
        return res.status(200).json({ orderId: oid, amount: amt, status: initialStatus, sn: initialSn, message: 'OK' });
    } catch (e) {
        return res.status(500).json({ message: e.message });
    }
});

app.listen(process.env.PORT || 10000, () => console.log('Server berjalan'));
