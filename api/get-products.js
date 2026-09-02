const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { brand } = req.body; 
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
            const searchKeyword = brand.toUpperCase();

            // Filter fleksibel: Mencocokkan brand atau nama produk yang mengandung kata kunci
            let filtered = data.data.filter(item => {
                const itemBrand = (item.brand || "").toUpperCase();
                const itemName = (item.product_name || "").toUpperCase();
                
                // Khusus Pulsa, pastikan mencocokkan operatornya
                return (itemBrand.includes(searchKeyword) || itemName.includes(searchKeyword)) && 
                       item.seller_product_status === true;
            });

            // Urutkan dari harga termurah
            filtered.sort((a, b) => a.price - b.price);

            // Atur margin keuntungan bersih kamu di sini (Contoh: Rp 1.500)
            const marginProfit = 1500; 
            
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
