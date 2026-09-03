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

// 1. Endpoint Ambil Produk Digiflazz
app.post('/api/get-products', async (req, res) => {
    const { brand, category } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });
    }

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

        let targetBrand = (brand || "").trim().toUpperCase();

        let filtered = data.filter(item => {
            let itemBrand = (item.brand || "").trim().toUpperCase();
            let itemName = (item.product_name || "").toUpperCase();
            
            let isMatch = false;
            if (targetBrand === 'TELKOMSEL') {
                isMatch = itemBrand.includes('TELKOMSEL') || itemBrand.includes('TSEL') || itemName.includes('TELKOMSEL') || itemName.includes('TSEL');
            } else if (targetBrand === 'INDOSAT') {
                isMatch = itemBrand.includes('INDOSAT') || itemBrand.includes('ISAT') || itemName.includes('INDOSAT') || itemName.includes('ISAT');
            } else if (targetBrand === 'TRI') {
                isMatch = itemBrand.includes('TRI') || itemBrand === '3' || itemName.includes('TRI');
            } else {
                isMatch = itemBrand.includes(targetBrand) || itemName.includes(targetBrand);
            }

            if (!isMatch) return false;

            if (category === 'pulsa') {
                if (itemName.includes('VOUCHER') || itemName.includes('WIFI')) {
                    return false;
                }
            }

            if (item.buyer_product_status === false || item.buyer_product_status === 0 || item.buyer_product_status === '0') {
                return false; 
            }

            return true;
        });

        filtered.sort((a, b) => a.price - b.price);

        const products = filtered.map(p => ({
            sku: p.buyer_sku_code,
            name: p.product_name,
            price: p.price + 200 // Profit promo Rp 200
        }));

        return res.status(200).json(products);
        
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 2. Endpoint Buat Transaksi Midtrans Snap Token
app.post('/api/create-transaction', async (req, res) => {
    try {
        const { targetId, productCode, price } = req.body;

        if (!targetId || !productCode || !price) {
            return res.status(400).json({ message: 'Target ID, Produk, dan Harga wajib diisi!' });
        }

        const orderId = 'TWIDY-' + Date.now();
        const amount = parseInt(price);

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
                transaction_details: {
                    order_id: orderId,
                    gross_amount: amount
                },
                customer_details: {
                    first_name: "Customer",
                    last_name: targetId 
                },
                item_details: [{
                    id: productCode,
                    price: amount,
                    quantity: 1,
                    name: `Top Up ${productCode}`
                }]
            })
        });

        const midtransData = await midtransResponse.json();

        if (!midtransResponse.ok) {
            return res.status(400).json({ message: 'Gagal membuat transaksi Midtrans', error: midtransData });
        }

        return res.status(200).json({
            token: midtransData.token,
            redirect_url: midtransData.redirect_url,
            order_id: orderId
        });

    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// 3. Endpoint Webhook Midtrans (Diperbaiki agar lolos uji Test URL)
app.post('/api/webhook', async (req, res) => {
    try {
        const notification = req.body;
        
        // Antisipasi jika Midtrans mengirim test ping kosong
        if (!notification || !notification.transaction_status) {
            return res.status(200).json({ status: "OK", message: "Webhook endpoint is active and ready." });
        }

        const transactionStatus = notification.transaction_status;
        const fraudStatus = notification.fraud_status;

        if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus === 'accept')) {
            const orderId = notification.order_id;
            const targetId = notification.customer_last_name; 
            const buyerSkuCode = notification.item_details && notification.item_details[0] ? notification.item_details[0].id : '';

            const username = process.env.DIGIFLAZZ_USERNAME;
            const apiKey = process.env.DIGIFLAZZ_API_KEY;

            if (!username || !apiKey || !buyerSkuCode || !targetId) {
                return res.status(500).json({ message: 'Data webhook / kredensial tidak lengkap' });
            }

            const refId = orderId;
            const sign = crypto.createHash('md5').update(username + apiKey + refId).digest('hex');

            const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    buyer_sku_code: buyerSkuCode,
                    customer_no: targetId,
                    ref_id: refId,
                    sign: sign
                })
            });

            const digiflazzResult = await digiflazzResponse.json();

            return res.status(200).json({
                status: "Success processed to Digiflazz",
                digiflazz_response: digiflazzResult
            });
        }

        return res.status(200).json({ message: "Notification received but not settlement yet." });

    } catch (error) {
        return res.status(500).json({ message: 'Webhook error: ' + error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
