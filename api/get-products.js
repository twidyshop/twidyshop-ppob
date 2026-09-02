const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { brand } = req.body; // Sekarang cuma butuh nama brand aja
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
        
        if (data.data && Array.isArray(data.data)) {
            // Ambil semua produk aktif
            let activeProducts = data.data.filter(item => item.seller_product_status === true || item.buyer_product_status === true);

            // Langsung filter berdasarkan brand yang diklik di web
            let filtered = activeProducts.filter(item => (item.brand || "").toUpperCase() === (brand || "").toUpperCase());
            filtered.sort((a, b) => a.price - b.price);

            const marginProfit = 1500; // Untung per transaksi lu
            const products = filtered.map(p => ({
                sku: p.buyer_sku_code,
                name: p.product_name,
                price: p.price + marginProfit
            }));

            return res.status(200).json(products);
        }
        return res.status(400).json({ message: 'Gagal ambil data, array kosong' });
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
}
