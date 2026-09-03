const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); // Tambahan untuk database permanen

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi Database SQLite
const db = new sqlite3.Database('./twidyshop_transactions.db', (err) => {
    if (err) console.error("Gagal membuka database:", err.message);
    else {
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            order_id TEXT PRIMARY KEY,
            target_id TEXT,
            product_code TEXT,
            product_name TEXT,
            amount INTEGER,
            status TEXT,
            sn TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("Database siap.");
    }
});

let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; 

// 1. Endpoint Ambil Produk Digiflazz (Filter Diperketat)
app.post('/api/get-products', async (req, res) => {
    const { brand, category } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });

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

        let targetBrand = (brand || "").trim().toUpperCase().replace(/\s+/g, ''); // Hapus spasi untuk pencocokan (GOPAY = GO PAY)

        let filtered = data.filter(item => {
            if (!item.buyer_product_status || item.buyer_product_status === false || item.buyer_product_status === '0') return false;

            let itemBrand = (item.brand || "").trim().toUpperCase().replace(/\s+/g, '');
            let itemName = (item.product_name || "").toUpperCase();
            
            // Pencocokan Merek yang Ketat
            let isMatch = (itemBrand === targetBrand) || (itemBrand.includes(targetBrand));
            if (!isMatch) return false;

            // Filter Kategori agar tidak nyasar
            if (category === 'pulsa') {
                if (itemName.includes('DATA') || itemName.includes('VOUCHER') || itemName.includes('WIFI') || itemName.includes('MASA AKTIF')) return false;
            } else if (category === 'pln') {
                if (!itemName.includes('TOKEN') && !itemName.includes('PLN')) return false;
            }

            return true;
        });

        filtered.sort((a, b) => a.price - b.price);
        const products = filtered.map(p => ({
            sku: p.buyer_sku_code,
            name: p.product_name,
            price: p.price + 200 // Profit markup Rp 200 (Bisa disesuaikan)
        }));

        return res.status(200).json(products);
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 2. Endpoint Buat Transaksi Midtrans Snap Token
app.post('/api/create-transaction', async (req, res) => {
    try {
        const { targetId, productCode, price, productName } = req.body;
        if (!targetId || !productCode || !price) return res.status(400).json({ message: 'Data tidak lengkap!' });

        const orderId = `TW_${productCode}_${Date.now()}`;
        const amount = parseInt(price);
        const midtransServerKey = process.env.MIDTRANS_SERVER_KEY;

        if (!midtransServerKey) return res.status(500).json({ message: 'MIDTRANS_SERVER_KEY belum diset!' });

        // Simpan ke SQLite
        db.run(`INSERT INTO transactions (order_id, target_id, product_code, product_name, amount, status, sn) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                [orderId, targetId, productCode, productName, amount, 'PENDING', '-'], (err) => {
            if (err) console.error("Gagal simpan DB:", err.message);
        });

        const authString = Buffer.from(midtransServerKey + ':').toString('base64');
        const midtransResponse = await fetch('https://app.midtrans.com/snap/v1/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Basic ${authString}`
            },
            body: JSON.stringify({
                transaction_details: { order_id: orderId, gross_amount: amount },
                customer_details: { first_name: "Customer", last_name: targetId },
                item_details: [{ id: productCode, price: amount, quantity: 1, name: productName }]
            })
        });

        const midtransData = await midtransResponse.json();
        if (!midtransResponse.ok) return res.status(400).json({ message: 'Gagal membuat transaksi Midtrans', error: midtransData });

        return res.status(200).json({ token: midtransData.token, order_id: orderId });
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 3. Endpoint Cek Status Transaksi (Riwayat)
app.get('/api/check-status/:query', (req, res) => {
    const query = `%${req.params.query.trim()}%`;
    
    db.all(`SELECT * FROM transactions WHERE order_id LIKE ? OR target_id LIKE ? ORDER BY created_at DESC LIMIT 10`, [query, query], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        if (rows.length > 0) return res.status(200).json({ success: true, data: rows });
        return res.status(404).json({ success: false, message: 'Riwayat tidak ditemukan.' });
    });
});

// 4. Endpoint Webhook Midtrans & Eksekusi Digiflazz
app.post('/api/webhook', async (req, res) => {
    try {
        const notification = req.body;
        if (!notification || !notification.transaction_status) return res.status(200).send("OK");

        const { transaction_status: transactionStatus, fraud_status: fraudStatus, order_id: orderId } = notification;

        if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus === 'accept')) {
            // Update status processing
            db.run(`UPDATE transactions SET status = 'PROCESSING' WHERE order_id = ?`, [orderId]);

            // Ambil data untuk Digiflazz dari DB
            db.get(`SELECT target_id, product_code FROM transactions WHERE order_id = ?`, [orderId], async (err, row) => {
                if (err || !row) return;

                const username = process.env.DIGIFLAZZ_USERNAME;
                const apiKey = process.env.DIGIFLAZZ_API_KEY;
                const sign = crypto.createHash('md5').update(username + apiKey + orderId).digest('hex');

                const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/transaction', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: username,
                        buyer_sku_code: row.product_code,
                        customer_no: row.target_id,
                        ref_id: orderId,
                        sign: sign
                    })
                });

                const digiflazzResult = await digiflazzResponse.json();
                if (digiflazzResult && digiflazzResult.data) {
                    db.run(`UPDATE transactions SET status = ?, sn = ? WHERE order_id = ?`, 
                        [digiflazzResult.data.status, digiflazzResult.data.sn || '-', orderId]);
                }
            });
        } else if (['cancel', 'expire', 'deny'].includes(transactionStatus)) {
            db.run(`UPDATE transactions SET status = 'FAILED' WHERE order_id = ?`, [orderId]);
        }
        return res.status(200).json({ message: "Status handled." });
    } catch (error) {
        return res.status(200).json({ message: 'Error: ' + error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
