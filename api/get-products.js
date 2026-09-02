const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { action, brand } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur di Vercel' });
    }

    const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');

    try {
        const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/price-list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cmd: 'prepaid',
                username: username,
                sign: sign
            })
        });

        const data = await digiflazzResponse.json();
        
        if (data.data) {
            let activeProducts = data.data.filter(item => item.seller_product_status === true);

            // Jika minta list semua brand/operator yang ada di akun
            if (action === 'get_all_brands') {
                let brands = [...new Set(activeProducts.map(item => item.brand))].sort();
                return res.status(200).json(brands);
            }

            // Jika user klik salah satu brand, ambil produknya
            const searchKeyword = (brand || "").toUpperCase();
            let filtered = activeProducts.filter(item => {
                const itemBrand = (item.brand || "").toUpperCase();
                return itemBrand === searchKeyword || itemBrand.includes(searchKeyword);
            });

            filtered.sort((a, b) => a.price - b.price);

            const marginProfit = 1500; // Atur keuntungan bersih lu di sini
            
            const products = filtered.map(p => ({
                sku: p.buyer_sku_code,
                name: p.product_name,
                price: p.price + marginProfit
            }));

            return res.status(200).json(products);
        }

        return res.status(400).json({ message: 'Gagal mengambil data dari Digiflazz' });
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
}
