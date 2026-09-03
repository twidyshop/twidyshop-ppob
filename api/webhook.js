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
            
            // Ekstrak buyerSkuCode dan targetId langsung dari struktur order_id kita
            // Format order_id: TWIDY-SKU_PRODUK-TARGET-TIMESTAMP
            const parts = orderId.split('-');
            if (parts.length < 4) {
                return res.status(400).json({ message: 'Format Order ID tidak dikenali oleh webhook.' });
            }

            const buyerSkuCode = parts[1];
            const targetId = parts[2];

            const username = process.env.DIGIFLAZZ_USERNAME;
            const apiKey = process.env.DIGIFLAZZ_API_KEY;

            if (!username || !apiKey) {
                return res.status(500).json({ message: 'Kredensial Digiflazz belum lengkap di Environment Variables Vercel!' });
            }

            const refId = orderId;
            const sign = crypto.createHash('md5').update(username + apiKey + refId).digest('hex');

            // TEMBAK KE DIGIFLAZZ PRODUCTION
            const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    buyer_sku_code: buyerSkuCode,
                    customer_no: targetId,
                    ref_id: refId,
                    sign: sign,
                    testing: false
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
