const crypto = require('crypto');

// Brankas memori sementara di server Vercel (Cache) dikembalikan ke 5 Menit
let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; 

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { brand, category } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });
    }

    try {
        const now = Date.now();
        let data = null;

        // Cek Memori 5 Menit
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
            let isActive = item.buyer_product_status === true || item.seller_product_status === true;
            if (!isActive) return false;

            let itemBrand = (item.brand || "").trim().toUpperCase();
            let isBrandMatch = itemBrand === targetBrand || itemBrand.includes(targetBrand);

            if (!isBrandMatch) return false;

            // FILTER PALING BENAR: Langsung baca kategori bawaan Digiflazz
            if (category === 'pulsa') {
                let itemCategory = (item.category || "").toUpperCase();
                return itemCategory === 'PULSA'; 
            }

            return true;
        });

        // Urutkan dari yang paling murah
        filtered.sort((a, b) => a.price - b.price);

        // Profit Rp 200 sesuai request
        const marginProfit = 200; 
        
        const products = filtered.map(p => ({
            sku: p.buyer_sku_code,
            name: p.product_name,
            price: p.price + marginProfit
        }));

        return res.status(200).json(products);
        
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
}
