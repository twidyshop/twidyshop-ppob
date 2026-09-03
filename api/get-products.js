const crypto = require('crypto');

// Brankas memori sementara di server Vercel (Cache) 5 Menit
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
            
            // Cek apakah data benar-benar ada dari Digiflazz
            if (rawData.data && Array.isArray(rawData.data)) {
                data = rawData.data;
                cachedProducts = data; 
                cacheTimestamp = now;  
            } else {
                return res.status(400).json({ message: 'Gagal ambil data dari pusat Digiflazz' });
            }
        }

        let targetBrand = (brand || "").trim().toUpperCase();

        // FILTER SUPER LONGGAR
        let filtered = data.filter(item => {
            let itemBrand = (item.brand || "").trim().toUpperCase();
            let itemName = (item.product_name || "").toUpperCase();
            
            // 1. Pastikan nama brand atau nama produk cocok dengan yang diklik (misal: TELKOMSEL)
            let isBrandMatch = itemBrand.includes(targetBrand) || itemName.includes(targetBrand);
            if (!isBrandMatch) return false;

            // 2. Filter khusus pulsa (Buang yang ada kata kunci paket data/voucher)
            if (category === 'pulsa') {
                if (itemName.includes('DATA') || 
                    itemName.includes('INTERNET') || 
                    itemName.includes('VOUCHER') || 
                    itemName.includes('WIFI') || 
                    itemName.includes('PAKET')) {
                    return false;
                }
            }

            // 3. Bypass cek status boolean yang ketat. 
            // Pokoknya selama Digiflazz tidak explicitly bilang false / 0, kita anggap produknya ADA.
            if (item.buyer_product_status === false || item.buyer_product_status === 0 || item.buyer_product_status === '0') {
                return false; 
            }

            return true;
        });

        // Urutkan harga dari yang termurah ke termahal
        filtered.sort((a, b) => a.price - b.price);

        // Profit Rp 200 perak
        const marginProfit = 200; 
        
        const products = filtered.map(p => ({
            sku: p.buyer_sku_code,
            name: p.product_name,
            price: p.price + marginProfit
        }));

        // Kembalikan daftar produk ke web
        return res.status(200).json(products);
        
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
}
