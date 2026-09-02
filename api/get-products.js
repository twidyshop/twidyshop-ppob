const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { action, category, brand } = req.body; 
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

            // FITUR 1: Ambil daftar brand otomatis berdasarkan kategori (Pulsa, Games, E-Wallet, PLN)
            if (action === 'get_brands_by_category') {
                let keyword = (category || "").toLowerCase();
                
                let matched = activeProducts.filter(item => {
                    let cat = (item.category || "").toLowerCase();
                    let brd = (item.brand || "").toLowerCase();
                    let name = (item.product_name || "").toLowerCase();

                    if (keyword === 'pulsa') {
                        return cat.includes('pulsa') || cat.includes('data') || brd.includes('telkomsel') || brd.includes('indosat') || brd.includes('axis') || brd.includes('xl') || brd.includes('tri') || brd.includes('smartfren') || brd.includes('by.u');
                    } else if (keyword === 'game') {
                        return cat.includes('game') || brd.includes('ml') || brd.includes('free fire') || brd.includes('pubg') || brd.includes('genshin');
                    } else if (keyword === 'ewallet') {
                        return cat.includes('e-money') || cat.includes('ewallet') || brd.includes('gopay') || brd.includes('dana') || brd.includes('ovo') || brd.includes('shopeepay');
                    } else if (keyword === 'token') {
                        return cat.includes('pln') || brd.includes('pln');
                    }
                    return false;
                });

                let brands = [...new Set(matched.map(item => item.brand))].sort();
                return res.status(200).json(brands);
            }

            // FITUR 2: Ambil list produk spesifik saat brand diklik
            const searchKeyword = (brand || "").toUpperCase();
            let filtered = activeProducts.filter(item => {
                const itemBrand = (item.brand || "").toUpperCase();
                const itemName = (item.product_name || "").toUpperCase();
                return itemBrand.includes(searchKeyword) || itemName.includes(searchKeyword);
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
