const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; 

const DB_FILE = path.join(__dirname, 'database.json');
let transactionDB = {};

function loadDB() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            transactionDB = JSON.parse(data);
        } catch (err) { console.error("Gagal membaca database.json", err); }
    } else {
        fs.writeFileSync(DB_FILE, JSON.stringify({}));
    }
}
loadDB();

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(transactionDB, null, 2));
    } catch (err) { console.error("Gagal menyimpan ke database.json", err); }
}

async function fetchDigiflazzProducts(username, apiKey) {
    const now = Date.now();
    if (cachedProducts && (now - cacheTimestamp < CACHE_DURATION)) {
        return cachedProducts;
    }
    const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');
    const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/price-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'prepaid', username, sign })
    });
    const rawData = await digiflazzResponse.json();
    if (rawData.data && Array.isArray(rawData.data)) {
        cachedProducts = rawData.data;
        cacheTimestamp = now;
        return cachedProducts;
    }
    return [];
}

// 1. Endpoint Ambil Daftar Brand (FILTER DILONGGARKAN 100% MENGIKUTI DIGI)
app.get('/api/get-brands/:category', async (req, res) => {
    const category = req.params.category.toLowerCase();
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });

    try {
        const data = await fetchDigiflazzProducts(username, apiKey);
        
        let filtered = data.filter(item => {
            // Abaikan produk yang statusnya mati total dari pusat
            if (item.buyer_product_status === false || item.buyer_product_status === 0 || item.buyer_product_status === '0') return false;
            
            let cat = (item.category || "").toLowerCase();
            let brand = (item.brand || "").toLowerCase();
            let name = (item.product_name || "").toLowerCase();

            if (category === 'games') {
                return cat.includes('game') || brand.includes('ml') || brand.includes('ff') || brand.includes('pubg') || brand.includes('gem') || name.includes('dm') || name.includes('uc') || name.includes('diamond');
            } else if (category === 'emoney') {
                return cat.includes('money') || cat.includes('wallet') || cat.includes('dana') || cat.includes('ovo') || cat.includes('gopay') || brand.includes('dana') || brand.includes('ovo') || brand.includes('gopay') || brand.includes('shopee') || brand.includes('linkaja') || name.includes('gopay') || name.includes('ovo') || name.includes('dana');
            } else if (category === 'pln') {
                return cat.includes('pln') || brand.includes('pln') || name.includes('token') || name.includes('pln');
            } else if (category === 'pulsa') {
                return (cat.includes('pulsa') || cat.includes('xl') || cat.includes('telkomsel') || cat.includes('indosat') || cat.includes('tri') || cat.includes('axis') || cat.includes('smartfren')) && !name.includes('voucher') && !name.includes('wifi');
            }
            return true; // Jika kategori lain, tampilkan semua
        });

        // Jika hasil filter kosong karena penamaan kategori dari digi beda, fallback tampilkan semua brand unik agar tidak kosong
        if (filtered.length === 0) {
            filtered = data;
        }

        let brandsSet = [...new Set(filtered.map(i => i.brand.toUpperCase()))].sort();
        return res.status(200).json(brandsSet);
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 2. Endpoint Ambil Produk Berdasarkan Brand
app.post('/api/get-products', async (req, res) => {
    const { brand } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });

    try {
        const data = await fetchDigiflazzProducts(username, apiKey);
        let targetBrand = (brand || "").trim().toUpperCase();

        let filtered = data.filter(item => {
            if (item.buyer_product_status === false || item.buyer_product_status === 0 || item.buyer_product_status === '0') return false;
            
            let itemBrand = (item.brand || "").trim().toUpperCase();
            let itemName = (item.product_name || "").toUpperCase();
            
            return itemBrand === targetBrand || itemBrand.includes(targetBrand) || itemName.includes(targetBrand);
        });

        filtered.sort((a, b) => a.price - b.price);

        const products = filtered.map(p => ({
            sku: p.buyer_sku_code,
            name: p.product_name,
            price: p.price + 200 // Profit markup Rp 200
        }));

        return res.status(200).json(products);
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 3. Endpoint Buat Transaksi Midtrans
app.post('/api/create-transaction', async (req, res) => {
    try {
        const { targetId, productCode, price, productName } = req.body;
        if (!targetId || !productCode || !price) return res.status(400).json({ message: 'Data tidak lengkap!' });

        const orderId = `TW_${productCode}_${Date.now()}`;
        const amount = parseInt(price);

        transactionDB[orderId] = {
            order_id: orderId,
            target_id: targetId,
            product_code: productCode,
            product_name: productName || productCode,
            amount: amount,
            status: 'PENDING',
            created_at: new Date().toISOString(),
            sn: '-'
        };
        saveDB();

        const midtransServerKey = process.env.MIDTRANS_SERVER_KEY;
        if (!midtransServerKey) return res.status(500).json({ message: 'MIDTRANS_SERVER_KEY belum diset!' });

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
                item_details: [{ id: productCode, price: amount, quantity: 1, name: (productName || `Top Up`).substring(0, 50) }]
            })
        });

        const midtransData = await midtransResponse.json();
        if (!midtransResponse.ok) return res.status(400).json({ message: 'Gagal Midtrans', error: midtransData });

        return res.status(200).json({ token: midtransData.token, redirect_url: midtransData.redirect_url, order_id: orderId });
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 4. Endpoint Cek Status
app.get('/api/check-status/:query', (req, res) => {
    const query = req.params.query.trim().toLowerCase();
    let matched = Object.values(transactionDB).filter(trx => {
        return trx.order_id.toLowerCase().includes(query) || trx.target_id.toLowerCase().includes(query);
    });
    matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (matched.length > 0) {
        return res.status(200).json({ success: true, data: matched });
    } else {
        return res.status(404).json({ success: false, message: 'Tidak ditemukan.' });
    }
});

// 5. Endpoint Webhook
app.post('/api/webhook', async (req, res) => {
    try {
        const notification = req.body;
        if (!notification || !notification.transaction_status) return res.status(200).json({ status: "OK" });

        const transactionStatus = notification.transaction_status;
        const orderId = notification.order_id;

        if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
            if (transactionDB[orderId]) transactionDB[orderId].status = 'SUCCESS (PROCESSING)';
            saveDB();

            let targetId = transactionDB[orderId] ? transactionDB[orderId].target_id : '';
            let buyerSkuCode = orderId.includes('_') ? orderId.split('_')[1] : '';

            const username = process.env.DIGIFLAZZ_USERNAME;
            const apiKey = process.env.DIGIFLAZZ_API_KEY;

            if (username && apiKey && buyerSkuCode && targetId) {
                const refId = orderId;
                const sign = crypto.createHash('md5').update(username + apiKey + refId).digest('hex');

                const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/transaction', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, buyer_sku_code: buyerSkuCode, customer_no: targetId, ref_id: refId, sign })
                });

                const digiflazzResult = await digiflazzResponse.json();
                if (digiflazzResult && digiflazzResult.data) {
                    if (transactionDB[orderId]) {
                        transactionDB[orderId].status = digiflazzResult.data.status;
                        transactionDB[orderId].sn = digiflazzResult.data.sn || '-';
                        saveDB();
                    }
                }
            }
        } else if (['cancel', 'expire', 'deny'].includes(transactionStatus)) {
            if (transactionDB[orderId]) {
                transactionDB[orderId].status = 'FAILED / EXPIRED';
                saveDB();
            }
        }

        return res.status(200).json({ message: "Handled" });
    } catch (error) {
        return res.status(200).json({ message: 'Error: ' + error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
