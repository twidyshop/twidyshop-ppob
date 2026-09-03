const crypto = require('crypto');

// Bikin brankas memori sementara di server Vercel (Cache)
let cachedProducts = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 60 * 1000; // Diset 1 Jam (60 menit x 60 detik x 1000 ms)

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

        // CEK MEMORI: Kalau data masih ada dan belum 1 jam, pakai data lama
        if (cachedProducts && (now - cacheTimestamp < CACHE_DURATION)) {
            data = cachedProducts;
        } else {
            // Kalau memori kosong atau udah lebih dari 1 jam, nembak ke Digiflazz lagi
            const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');
            const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/price-list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd: 'prepaid', username, sign })
            });

            const rawData = await digiflazzResponse.json();
            
            if (rawData.data && Array.isArray(rawData.data)) {
                data = rawData.data;
                cachedProducts = data; // Simpan ke dalam memori
                cacheTimestamp = now;  // Catat waktu penyimpanannya
            } else {
                return res.status(400).json({ message: 'Gagal ambil data dari pusat' });
            }
        }

        // --- Proses Filter Data yang Sudah Ada di Memori ---
        let targetBrand = (brand || "").trim().toUpperCase();

        let filtered = data.filter(item => {
            // Longgarkan status produk
            let isActive = item.seller_product_status === true || item.buyer_product_status === true || item.seller_product_status === 1;
            if (!isActive) return false;

            let itemBrand = (item.brand || "").trim().toUpperCase();
            let isBrandMatch = itemBrand === targetBrand || itemBrand.includes(targetBrand);

            if (!isBrandMatch) return false;

            // Pisahkan Pulsa Reguler secara ketat (tidak campur paket data/telpon)
            if (category === 'pulsa') {
                let productName = (item.product_name || "").toUpperCase();
                let isPulsaReguler = productName.includes(targetBrand) && 
                                     (productName.includes('PULSA') || !productName.includes('DATA')) &&
                                     !productName.includes('INTERNET') && 
                                     !productName.includes('DATA') && 
                                     !productName.includes('TELPON') && 
                                     !productName.includes('VOUCHER') &&
                                     !productName.includes('PAKET');
                return isPulsaReguler;
            }

            return true;
        });

        // Urutkan dari yang paling murah
        filtered.sort((a, b) => a.price - b.price);

        // PROFIT PROMO: Cuan tipis Rp 200 perak
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
