const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { brand, category } = req.body; 
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

            // Filter produk aktif dari pusat
            let filtered = data.data.filter(item => {
                let isActive = item.seller_product_status === true || item.buyer_product_status === true || item.seller_product_status === 1;
                if (!isActive) return false;

                let itemBrand = (item.brand || "").trim().toUpperCase();
                let isBrandMatch = itemBrand === targetBrand || itemBrand.includes(targetBrand);

                if (!isBrandMatch) return false;

                // KHUSUS KATEGORI PULSA: Saring ketat agar HANYA mengambil pulsa reguler
                if (category === 'pulsa') {
                    let productName = (item.product_name || "").toUpperCase();
                    // Pastikan mengandung nama brand DAN ada kata pulsa, tapi TIDAK mengandung kata data/internet/telpon/voucher
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
