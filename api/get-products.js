const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { action, category, brand } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur' });
    }

    const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');

    try {
        const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/price-list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: 'prepaid', username, sign })
        });

        const data = await digiflazzResponse.json();
        
        if (data.data) {
            let activeProducts = data.data.filter(item => item.seller_product_status === true);

            // Ambil daftar brand berdasarkan kategori tombol yang diklik user
            if (action === 'get_brands') {
                let catQuery = (category || "").toLowerCase();
                let matched = activeProducts.filter(item => {
                    let c = (item.category || "").toLowerCase();
                    if (catQuery === 'pulsa') return c.includes('pulsa') || c.includes('data');
                    if (catQuery === 'game') return c.includes('game');
                    if (catQuery === 'token') return c.includes('pln');
                    if (catQuery === 'ewallet') return c.includes('e-money') || c.includes('ewallet');
                    return false;
                });
                let brands = [...new Set(matched.map(item => item.brand))].sort();
                return res.status(200).json(brands);
            }

            // Ambil produk spesifik dari brand yang dipilih
            let filtered = activeProducts.filter(item => (item.brand || "").toUpperCase() === (brand || "").toUpperCase());
            filtered.sort((a, b) => a.price - b.price);

            const marginProfit = 1500; // Keuntungan bersih lu
            const products = filtered.map(p => ({
                sku: p.buyer_sku_code,
                name: p.product_name,
                price: p.price + marginProfit
            }));

            return res.status(200).json(products);
        }
        return res.status(400).json({ message: 'Gagal ambil data' });
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
}
