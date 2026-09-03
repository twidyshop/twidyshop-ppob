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

// 1. Endpoint Ambil Produk (Filter Lebih Longgar untuk GoPay & PUBG)
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

        let targetBrand = (brand || "").trim().toUpperCase().replace(/\s+/g, '');

        let filtered = data.filter(item => {
            if (!item.buyer_product_status || item.buyer_product_status === false || item.buyer_product_status === '0') return false;

            let itemBrand = (item.brand || "").trim().toUpperCase().replace(/\s+/g, '');
            let itemName = (item.product_name || "").toUpperCase().replace(/\s+/g, '');
            
            // Pencocokan fleksibel untuk GoPay, PUBG, dll
            let isMatch = itemBrand.includes(targetBrand) || itemName.includes(targetBrand);
            
            // Kasus khusus GoPay / E-Money
            if (targetBrand === 'GOPAY' && (itemName.includes('GO-PAY') || itemName.includes('GOPAY'))) isMatch = true;
            // Kasus khusus PUBG
            if (targetBrand === 'PUBG' && itemName.includes('PUBG')) isMatch = true;

            if (!isMatch) return false;

            if (category === 'pulsa') {
                if (itemName.includes('DATA') || itemName.includes('VOUCHER') || itemName.includes('WIFI') || itemName.includes('MASAAKTIF')) return false;
            } else if (category === 'pln') {
                if (!itemName.includes('TOKEN') && !itemName.includes('PLN')) return false;
            }

            return true;
        });

        filtered.sort((a, b) => a.price - b.price);
        const products = filtered.map(p => ({
            sku: p.buyer_sku_code,
            name: p.product_name,
            price: p.price + 200 
        }));

        return res.status(200).json(products);
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 2. Endpoint Buat Transaksi Midtrans
app.post('/api/create-transaction', async (req, res) => {
    try {
        const { targetId, productCode, price, productName } = req.body;
        if (!targetId || !productCode || !price) return res.status(400).json({ message: 'Data tidak lengkap!' });

        const orderId = `TW_${productCode}_${Date.now()}`;
        const amount = parseInt(price);
        const midtransServerKey = process.env.MIDTRANS_SERVER_KEY;

        if (!midtransServerKey) return res.status(500).json({ message: 'MIDTRANS_SERVER_KEY belum diset!' });

        const db = readDB();
        db.push({
            order_id: orderId,
            target_id: targetId,
            product_code: productCode,
            product_name: productName,
            amount: amount,
            status: 'PENDING',
            sn: '-',
            created_at: new Date().toISOString()
        });
        saveDB(db);

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

// 3. Endpoint Cek Status
app.get('/api/check-status/:query?', (req, res) => {
    const query = (req.params.query || '').trim().toLowerCase();
    const db = readDB();
    
    let matched = db;
    if (query && query !== 'all') {
        matched = db.filter(trx => 
            trx.order_id.toLowerCase().includes(query) || 
            trx.target_id.toLowerCase().includes(query)
        );
    }

    matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (matched.length > 0) {
        return res.status(200).json({ success: true, data: matched });
    } else {
        return res.status(404).json({ success: false, message: 'Riwayat tidak ditemukan.' });
    }
});

// 4. Endpoint Webhook Midtrans & Eksekusi Digiflazz (Diberikan Log untuk Debugging)
app.post('/api/webhook', async (req, res) => {
    console.log("WEBHOOK HIT RECEIVED:", JSON.stringify(req.body));
    try {
        const notification = req.body;
        if (!notification || !notification.transaction_status) return res.status(200).send("OK");

        const { transaction_status: transactionStatus, fraud_status: fraudStatus, order_id: orderId } = notification;

        let db = readDB();
        let trxIndex = db.findIndex(t => t.order_id === orderId);
        
        if (trxIndex === -1) {
            console.log("Webhook Error: Order ID tidak ditemukan di database lokal:", orderId);
            return res.status(200).send("Order not found in local db");
        }

        if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus === 'accept')) {
            db[trxIndex].status = 'PROCESSING';
            saveDB(db);

            const username = process.env.DIGIFLAZZ_USERNAME;
            const apiKey = process.env.DIGIFLAZZ_API_KEY;
            const sign = crypto.createHash('md5').update(username + apiKey + orderId).digest('hex');

            const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    buyer_sku_code: db[trxIndex].product_code,
                    customer_no: db[trxIndex].target_id,
                    ref_id: orderId,
                    sign: sign
                })
            });

            const digiflazzResult = await digiflazzResponse.json();
            console.log("DIGIFLAZZ EXECUTION RESULT:", digiflazzResult);
            
            if (digiflazzResult && digiflazzResult.data) {
                db = readDB();
                trxIndex = db.findIndex(t => t.order_id === orderId);
                db[trxIndex].status = digiflazzResult.data.status;
                db[trxIndex].sn = digiflazzResult.data.sn || '-';
                saveDB(db);
            }
        } else if (['cancel', 'expire', 'deny'].includes(transactionStatus)) {
            db[trxIndex].status = 'FAILED';
            saveDB(db);
        }
        return res.status(200).json({ message: "Status handled." });
    } catch (error) {
        console.error("WEBHOOK EXCEPTION ERROR:", error);
        return res.status(200).json({ message: 'Error: ' + error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
