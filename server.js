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
        return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } catch (e) {
        return [];
    }
};

const saveDB = (data) => {
    fs.writeFileSync(dbFile, JSON.stringify(data.slice(-100), null, 2));
};

let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000;

app.post('/api/get-products', async (req, res) => {
    const { brand } = req.body;
    const user = process.env.DIGIFLAZZ_USERNAME;
    const key = process.env.DIGIFLAZZ_API_KEY;
    if (!user || !key) return res.status(500).json({ message: 'API Key belum diset' });
    
    try {
        const now = Date.now();
        if (!cachedProducts || (now - cacheTimestamp > CACHE_DURATION)) {
            const sign = crypto.createHash('md5').update(user + key + 'pricelist').digest('hex');
            const resp = await fetch('https://api.digiflazz.com/v1/price-list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd: 'prepaid', username: user, sign })
            });
            const raw = await resp.json();
            if (raw.data && Array.isArray(raw.data)) {
                cachedProducts = raw.data;
                cacheTimestamp = now;
            } else {
                return res.status(400).json({ message: 'Gagal ambil data' });
            }
        }
        let tb = (brand || "").toUpperCase().replace(/[^A-Z0-9]/g, '');
        let filtered = cachedProducts;
        if (tb) {
            filtered = cachedProducts.filter(i => 
                (i.brand || "").toUpperCase().includes(tb) || 
                (i.category || "").toUpperCase().includes(tb) || 
                (i.product_name || "").toUpperCase().includes(tb)
            );
        }
        res.json(filtered);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get(['/api/transactions', '/api/transaction', '/api/history', '/api/riwayat'], (req, res) => {
    try {
        return res.status(200).json(readDB().reverse());
    } catch (e) {
        return res.status(500).json({ message: 'Error DB' });
    }
});

app.post('/api/create-transaction', async (req, res) => {
    try {
        const { targetId, productCode, price, productName } = req.body;
        if (!targetId || !productCode) return res.status(400).json({ message: 'Data kurang' });

        const orderId = `TW_${productCode}_${Date.now()}`;
        const amount = parseInt(price || 0);

        const db = readDB();
        db.push({
            order_id: orderId,
            target_id: targetId,
            product_code: productCode,
            product_name: productName || 'PPOB',
            amount: amount,
            status: 'UNPAID',
            sn: '-',
            created_at: new Date().toISOString()
        });
        saveDB(db);

        const sKey = process.env.MIDTRANS_SERVER_KEY;
        const authString = Buffer.from(sKey.trim() + ':').toString('base64');
        const mtResp = await fetch('https://app.midtrans.com/snap/v1/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authString}`
            },
            body: JSON.stringify({
                transaction_details: { order_id: orderId, gross_amount: amount },
                customer_details: { first_name: "Customer", last_name: targetId }
            })
        });

        const mtData = await mtResp.json();
        if (!mtResp.ok) return res.status(400).json({ message: 'Gagal Midtrans', error: mtData });

        return res.status(200).json({ token: mtData.token, orderId, amount, status: 'UNPAID', message: 'OK' });
    } catch (e) {
        return res.status(500).json({ message: e.message });
    }
});

app.post('/api/webhook', async (req, res) => {
    try {
        const notif = req.body;
        if (!notif || !notif.transaction_status) return res.status(200).send("OK");
        
        const { transaction_status, order_id } = notif;
        let db = readDB();
        let trx = db.find(t => t.order_id === order_id);
        if (!trx) return res.status(200).send("OK");

        if (transaction_status === 'settlement' || transaction_status === 'capture') {
            if (['SUKSES', 'DIPROSES', 'GAGAL'].includes(trx.status)) return res.status(200).send("OK");
            
            trx.status = 'DIPROSES';
            saveDB(db);
            
            const user = process.env.DIGIFLAZZ_USERNAME;
            const key = process.env.DIGIFLAZZ_API_KEY;
            if (user && key) {
                const sign = crypto.createHash('md5').update(user + key + order_id).digest('hex');
                try {
                    const digiRes = await fetch('https://api.digiflazz.com/v1/transaction', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: user,
                            buyer_sku_code: trx.product_code,
                            customer_no: trx.target_id,
                            ref_id: order_id,
                            sign: sign,
                            testing: false
                        })
                    });
                    const digiData = await digiRes.json();
                    const result = digiData.data || {};
                    
                    if (result.status === 'Sukses' || result.status === 0) {
                        trx.status = 'SUKSES';
                    } else if (result.status === 'Gagal') {
                        trx.status = 'GAGAL';
                    } else {
                        trx.status = 'DIPROSES';
                    }
                    trx.sn = result.sn || '-';
                    saveDB(db);
                } catch (err) {
                    console.error("Digiflazz Error:", err);
                }
            }
        } 
        else if (['expire', 'cancel', 'deny'].includes(transaction_status)) {
            trx.status = 'GAGAL';
            saveDB(db);
        } 
        else if (transaction_status === 'pending') {
            trx.status = 'UNPAID';
            saveDB(db);
        }
        return res.status(200).send("OK");
    } catch (e) {
        return res.status(500).send("Error");
    }
});

app.listen(process.env.PORT || 10000, () => console.log('Server berjalan'));
