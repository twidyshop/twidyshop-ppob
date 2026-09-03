const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; 

const transactionDB = {};

// Helper Ambil Data Pricelist Digiflazz
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

// 1. Endpoint Ambil Daftar Brand / Game Otomatis dari Digiflazz
app.get('/api/get-brands/:category', async (req, res) => {
    const category = req.params.category.toLowerCase();
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });
    }

    try {
        const data = await fetchDigiflazzProducts(username, apiKey);
        let filtered = data.filter(item => {
            if (item.buyer_product_status === false || item.buyer_product_status === 0 || item.buyer_product_status === '0') return false;
            let cat = (item.category || "").toLowerCase();
            let brand = (item.brand || "").toLowerCase();
            let name = (item.product_name || "").toLowerCase();

            if (category === 'games') {
                return cat.includes('games') || brand.includes('ml') || brand.includes('free fire') || brand.includes('pubg') || brand.includes('genshin') || name.includes('diamond') || name.includes('uc ');
            } else if (category === 'emoney') {
                return cat.includes('e-money') || brand.includes('dana') || brand.includes('ovo') || brand.includes('gopay') || brand.includes('shopeepay');
            } else if (category === 'pln') {
                return cat.includes('pln') || brand.includes('pln');
            } else if (category === 'pulsa') {
                return cat.includes('pulsa') && !name.includes('voucher') && !name.includes('wifi');
            }
            return false;
        });

        // Ambil daftar brand unik secara otomatis
        let brandsSet = [...new Set(filtered.map(i => i.brand))].sort();
        return res.status(200).json(brandsSet);
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 2. Endpoint Ambil Produk Berdasarkan Brand
app.post('/api/get-products', async (req, res) => {
    const { brand, category } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });
    }

    try {
        const data = await fetchDigiflazzProducts(username, apiKey);
        let targetBrand = (brand || "").trim().toUpperCase();

        let filtered = data.filter(item => {
            let itemBrand = (item.brand || "").trim().toUpperCase();
            let itemName = (item.product_name || "").toUpperCase();
            
            let isMatch = itemBrand === targetBrand || itemBrand.includes(targetBrand) || itemName.includes(targetBrand);
            if (!isMatch) return false;

            if (category === 'pulsa' && (itemName.includes('VOUCHER') || itemName.includes('WIFI'))) return false;
            if (item.buyer_product_status === false || item.buyer_product_status === 0 || item.buyer_product_status === '0') return false;

            return true;
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

        if (!targetId || !productCode || !price) {
            return res.status(400).json({ message: 'Data tidak lengkap!' });
        }

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

        const midtransServerKey = process.env.MIDTRANS_SERVER_KEY;
        if (!midtransServerKey) {
            return res.status(500).json({ message: 'MIDTRANS_SERVER_KEY belum diset di Render!' });
        }

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
                item_details: [{ id: productCode, price: amount, quantity: 1, name: productName || `Top Up ${productCode}` }]
            })
        });

        const midtransData = await midtransResponse.json();
        if (!midtransResponse.ok) {
            return res.status(400).json({ message: 'Gagal membuat transaksi Midtrans', error: midtransData });
        }

        return res.status(200).json({ token: midtransData.token, redirect_url: midtransData.redirect_url, order_id: orderId });
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 4. Endpoint Cek Status Global
app.get('/api/check-status/:query', (req, res) => {
    const query = req.params.query.trim().toLowerCase();
    let matched = Object.values(transactionDB).filter(trx => {
        return trx.order_id.toLowerCase().includes(query) || trx.target_id.toLowerCase().includes(query);
    });
    matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (matched.length > 0) {
        return res.status(200).json({ success: true, data: matched });
    } else {
        return res.status(404).json({ success: false, message: 'Tidak ditemukan riwayat transaksi.' });
    }
});

// 5. Endpoint Webhook Midtrans & Eksekusi Digiflazz
app.post('/api/webhook', async (req, res) => {
    try {
        const notification = req.body;
        if (!notification || !notification.transaction_status) return res.status(200).json({ status: "OK" });

        const transactionStatus = notification.transaction_status;
        const orderId = notification.order_id;

        if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
            if (transactionDB[orderId]) transactionDB[orderId].status = 'SUCCESS (PROCESSING)';

            let targetId = notification.customer_details ? (notification.customer_details.last_name || notification.customer_details.full_name) : '';
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
                    }
                }
            }
        } else if (['cancel', 'expire', 'deny'].includes(transactionStatus)) {
            if (transactionDB[orderId]) transactionDB[orderId].status = 'FAILED / EXPIRED';
        }

        return res.status(200).json({ message: "Handled" });
    } catch (error) {
        return res.status(200).json({ message: 'Error: ' + error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
