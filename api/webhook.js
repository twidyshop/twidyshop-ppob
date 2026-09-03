const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const notification = req.body;
        const transactionStatus = notification.transaction_status;
        const fraudStatus = notification.fraud_status;

        // Cek kalau pembayaran sukses / settlement dari Midtrans
        if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus === 'accept')) {
            const orderId = notification.order_id;
            
            // Ambil nomor tujuan / target ID dengan aman dari customer_last_name atau custom field
            const targetId = notification.customer_last_name || ""; 
            
            // Ambil SKU produk langsung dari item_details Midtrans
            let buyerSkuCode = notification.item_details && notification.item_details[0] ? notification.item_details[0].id : null;

            const username = process.env.DIGIFLAZZ_USERNAME;
            const apiKey = process.env.DIGIFLAZZ_API_KEY;

            if (!username || !apiKey) {
                return res.status(500).json({ message: 'Kredensial Digiflazz belum lengkap di Environment Variables Vercel!' });
            }

            if (!buyerSkuCode || !targetId) {
                return res.status(400).json({ message: 'Gagal memproses: SKU Produk atau Target ID tidak ditemukan dari payload Midtrans.' });
            }

            const refId = orderId;
            // Rumus MD5 Signature Digiflazz: username + apiKey + ref_id
            const sign = crypto.createHash('md5').update(username + apiKey + refId).digest('hex');

            // TEMBAK KE ENDPOINT TRANSAKSI DIGIFLAZZ PRODUCTION
            const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    buyer_sku_code: buyerSkuCode,
                    customer_no: targetId,
                    ref_id: refId,
                    sign: sign,
                    testing: false // Ubah ke true kalau mau mode sandbox/uji coba Digiflazz
                })
            });

            const digiflazzResult = await digiflazzResponse.json();

            return res.status(200).json({
                status: "Success processed to Digiflazz",
                digiflazz_response: digiflazzResult
            });
        }

        return res.status(200).json({ message: "Notification received but not settlement yet." });

    } catch (error) {
        return res.status(500).json({ message: 'Webhook processing error: ' + error.message });
    }
}
