const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { action, category, brand } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });
    }

    // Pembuatan signature MD5 sesuai dokumentasi Digiflazz
    const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');

    try {
        const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/price-list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: 'prepaid', username, sign })
        });

        const data = await digiflazzResponse.json();
        
        // Pastikan response data valid dan berbentuk array
        if (data.data && Array.isArray(data.data)) {
            // Gunakan buyer_product_status untuk memastikan produk aktif dan bisa kamu beli
            let activeProducts = data.data.filter(item => item.buyer_product_status === true);

            // Filter brand sesuai kategori yang dipilih dari frontend
            if (action === 'get_brands') {
                let cat = (category || "").toLowerCase();
                let matched = activeProducts.filter(item => {
                    let c = (item.category || "").toLowerCase();
                    // Pencocokan kategori diperluas sesuai dashboard Digiflazz
                    if (cat === 'pulsa') return c === 'pulsa' || c === 'data' || c === 'paket sms & telpon' || c === 'masa aktif';
                    if (cat === 'games') return c === 'games' || c === 'voucher' || c === 'aktivasi voucher';
                    if (cat === 'pln') return c === 'pln';
                    if (cat === 'emoney') return c === 'e-money' || c === 'e-wallet' || c.includes('saldo');
                    return false;
                });
                
                // Ambil daftar brand unik
                let brands = [...new Set(matched.map(item => item.brand))].sort();
                return res.status(200).json(brands);
            }

            // Ambil nominal produk berdasarkan brand untuk halaman checkout
            if (action === 'get_products') {
                let filtered = activeProducts.filter(item => (item.brand || "").toUpperCase() === (brand || "").toUpperCase());
                
                // Urutkan dari harga termurah ke termahal
                filtered.sort((a, b) => a.price - b.price);

                const marginProfit = 1500; // Keuntungan bersih per transaksi
                const products = filtered.map(p => ({
                    sku: p.buyer_sku_code,
                    name: p.product_name,
                    price: p.price + marginProfit
                }));

                return res.status(200).json(products);
            }
        }
        
        return res.status(400).json({ message: 'Gagal ambil data, periksa response Digiflazz' });
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
}
