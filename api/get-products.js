const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { brand } = req.body; 
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
            let targetBrand = (brand || "").trim().toUpperCase();

            // Longgarkan filter: Asal brand cocok dan produk aktif, langsung ambil!
            let filtered = data.data.filter(item => {
                let itemBrand = (item.brand || "").trim().toUpperCase();
                return itemBrand === targetBrand || itemBrand.includes(targetBrand);
            });

            // Urutkan dari harga termurah
            filtered.sort((a, b) => a.price - b.price);

            const marginProfit = 1500; // Keuntungan bersih lu per transaksi
            
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
