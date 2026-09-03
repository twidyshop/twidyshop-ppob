const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Agar file index.html dan aset frontend terbaca di Render
app.use(express.static(path.join(__dirname, 'public')));
// Kalau file index.html lu taruh di luar folder public (di root utama), ganti baris atas jadi: app.use(express.static(__dirname));

let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // Cache 5 menit

// Endpoint Ambil Produk Digiflazz
app.post('/api/get-products', async (req, res) => {
    const { brand, category } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur di Environment Variables Render' });
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
                return res.status(400).json({ message: 'Gagal ambil data dari pusat Digiflazz' });
            }
        }

        let targetBrand = (brand || "").trim().toUpperCase();

        let filtered = data.filter(item => {
            let itemBrand = (item.brand || "").trim().toUpperCase();
            let itemName = (item.product_name || "").toUpperCase();
            
            let isBrandMatch = itemBrand.includes(targetBrand) || itemName.includes(targetBrand);
            if (!isBrandMatch) return false;

            if (category === 'pulsa') {
                if (itemName.includes('DATA') || 
                    itemName.includes('INTERNET') || 
                    itemName.includes('VOUCHER') || 
                    itemName.includes('WIFI') || 
                    itemName.includes('PAKET')) {
                    return false;
                }
            }

            if (item.buyer_product_status === false || item.buyer_product_status === 0 || item.buyer_product_status === '0') {
                return false; 
            }

            return true;
        });

        filtered.sort((a, b) => a.price - b.price);

        const marginProfit = 200; // Profit promo Rp 200
        
        const products = filtered.map(p => ({
            sku: p.buyer_sku_code,
            name: p.product_name,
            price: p.price + marginProfit
        }));

        return res.status(200).json(products);
        
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
