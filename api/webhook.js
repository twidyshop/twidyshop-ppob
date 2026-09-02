const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const notification = req.body;
        const transactionStatus = notification.transaction_status;
        const fraudStatus = notification.fraud_status;

        // Cek kalau pembayaran sukses
        if (transactionStatus === 'settlement' || (transactionStatus === 'capture' && fraudStatus === 'accept')) {
            const orderId = notification.order_id;
            const targetId = notification.customer_last_name; 
            const buyerSkuCode = notification.item_details && notification.item_details[0] ? notification.item_details[0].id : 'test';

            const username = process.env.DIGIFLAZZ_USERNAME;
            const apiKey = process.env.DIGIFLAZZ_API_KEY;

            if (!username || !apiKey) {
                return res.status(500).json({ message: 'Kredensial Digiflazz belum lengkap di Environment Variables Vercel!' });
            }

            const refId = orderId;
            const sign = crypto.createHash('md5').update(username + apiKey + refId).digest('hex');

            // ENDPOINT DIGIFLAZZ PRODUCTION
            const digiflazzResponse = await fetch('https://api.digiflazz.com/v1/transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    buyer_sku_code: buyerSkuCode,
                    customer_no: targetId,
                    ref_id: refId,
                    sign: sign
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
