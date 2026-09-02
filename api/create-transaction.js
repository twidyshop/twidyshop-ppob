const midtransClient = require('midtrans-client');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { targetId, productCode } = req.body;

    // Database harga asli di server (Sinkronkan dengan Digiflazz)
    const productCatalog = {
        'G1': { name: '100 Diamond', price: 15000, buyerSkuCode: 'ml100' },
        'G2': { name: '300 Diamond', price: 45000, buyerSkuCode: 'ml300' },
        'P1': { name: 'Pulsa 20.000', price: 21000, buyerSkuCode: 'tsel20' },
        'P2': { name: 'Pulsa 50.000', price: 51000, buyerSkuCode: 'tsel50' }
    };

    const selectedProduct = productCatalog[productCode];
    if (!selectedProduct) return res.status(400).json({ message: 'Produk tidak valid' });

    let snap = new midtransClient.Snap({
        isProduction: false, // Ubah jadi true kalau sudah live/production
        serverKey: process.env.MIDTRANS_SERVER_KEY 
    });

    const orderId = "TWIDY-" + Date.now();

    let parameter = {
        "transaction_details": {
            "order_id": orderId,
            "gross_amount": selectedProduct.price
        },
        "item_details": [{
            "id": productCode,
            "price": selectedProduct.price,
            "quantity": 1,
            "name": selectedProduct.name
        }],
        "customer_details": {
            "first_name": "Tujuan:",
            "last_name": targetId
        }
    };

    try {
        const transaction = await snap.createTransaction(parameter);
        
        // Simpan sementara orderId dan targetId/buyerSkuCode jika perlu (bisa pakai database, atau di-encode ke catatan)
        
        res.status(200).json({ token: transaction.token });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
