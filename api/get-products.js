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
            // FITUR 1: Kalau diminta 'get_brands', kirim daftar semua brand/operator pulsa yang aktif ke web
            if (action === 'get_brands') {
                let activeProducts = data.data.filter(item => item.seller_product_status === true);
                
                // Ambil daftar brand unik khusus kategori Pulsa
                let pulsaBrands = [...new Set(activeProducts
                    .filter(item => item.category.toLowerCase().includes('pulsa') || item.brand.toLowerCase().includes('telkomsel') || item.brand.toLowerCase().includes('indosat') || item.brand.toLowerCase().includes('axis') || item.brand.toLowerCase().includes('xl') || item.brand.toLowerCase().includes('tri') || item.brand.toLowerCase().includes('smartfren'))
                    .map(item => item.brand))]
                    .sort();

                return res.status(200).json(pulsaBrands);
            }

            // FITUR 2: Kalau user klik salah satu brand, ambil produk spesifiknya + margin profit
            const searchKeyword = (brand || "").toUpperCase();
            let filtered = data.data.filter(item => {
                const itemBrand = (item.brand || "").toUpperCase();
                const itemName = (item.product_name || "").toUpperCase();
                return (itemBrand.includes(searchKeyword) || itemName.includes(searchKeyword)) && 
                       item.seller_product_status === true;
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
