const crypto = require('crypto');

export default async function handler(req, res) {
    // Aktifkan CORS agar frontend bisa mengakses API tanpa kendala
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { brand } = req.body; 
    const username = process.env.DIGIFLAZZ_USERNAME;
    const apiKey = process.env.DIGIFLAZZ_API_KEY;

    if (!username || !apiKey) {
        return res.status(500).json({ message: 'API Key Digiflazz belum diatur di Environment Variables Vercel.' });
    }

    // Pembuatan Signature Valid untuk Pricelist Prepaid Digiflazz
    const sign = crypto.createHash('md5').update(username + apiKey + 'pricelist').digest('hex');

    try {
        const digiflazzResponse = await fetch('https://digiflazz.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: 'prepaid', username, sign })
        });

        const data = await digiflazzResponse.json();
        
        // JIKA DIGIFLAZZ MENGEMBALIKAN ERROR (IP diblokir, salah key, dll)
        if (data.rc && data.rc !== '00') {
            return res.status(400).json({ 
                message: `Digiflazz Error (${data.rc}): ${data.message}. Pastikan IP Vercel / Whitelist All IP di Digiflazz sudah diaktifkan.` 
            });
        }
        
        if (data.data && Array.isArray(data.data)) {
            let targetBrand = (brand || "").trim().toUpperCase();

            // KONSISTENSI MAPPING BRAND (Solusi agar Telkomsel/Game/E-Money tidak kosong)
            let alterBrand = targetBrand;
            if (targetBrand === "TELKOMSEL") alterBrand = "TSEL";
            if (targetBrand === "MOBILE LEGENDS") alterBrand = "DIAMOND MOBILE LEGENDS";
            if (targetBrand === "FREE FIRE") alterBrand = "FREE FIRE";
            if (targetBrand === "GO PAY") alterBrand = "GOPAY";
            if (targetBrand === "SHOPEE PAY") alterBrand = "SHOPEEPAY";

            // Proses Filter Super Longgar
            let filtered = data.data.filter(item => {
                let itemBrand = (item.brand || "").trim().toUpperCase();
                let itemName = (item.product_name || "").trim().toUpperCase();
                
                // Pastikan produk berstatus aktif (bisa dibeli)
                const isAvailable = item.buyer_product_status === true && item.seller_product_status === true;
                if (!isAvailable) return false;

                // COCOKKAN BRAND: Menggunakan nama asli dari frontend atau alias dari Digiflazz
                const matchBrand = itemBrand.includes(targetBrand) || 
                                    itemBrand.includes(alterBrand) || 
                                    itemName.includes(targetBrand) || 
                                    itemName.includes(alterBrand);
                                    
                return matchBrand;
            });

            // Urutkan dari harga termurah
            filtered.sort((a, b) => a.price - b.price);

            const marginProfit = 1500; // Keuntungan bersih Anda per transaksi
            
            const products = filtered.map(p => ({
                sku: p.buyer_sku_code,
                name: p.product_name,
                price: p.price + marginProfit
            }));

            // Jika hasil filter kosong setelah dicari
            if (products.length === 0) {
                return res.status(200).json({ 
                    message: `Produk untuk brand '${brand}' saat ini tidak tersedia atau sedang gangguan di Digiflazz.`,
                    products: [] 
                });
            }

            return res.status(200).json(products);
        }
        
        return res.status(400).json({ message: 'Gagal mengambil data, format data dari pusat tidak valid.' });
    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
}
