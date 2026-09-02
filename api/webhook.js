const md5 = require('md5');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const notification = req.body;

    // Pastikan status pembayaran dari Midtrans benar-benar sukses/settlement
    if (notification.transaction_status === 'settlement' || notification.transaction_status === 'capture') {
        const orderId = notification.order_id;
        
        // Ambil data tujuan (nomor HP/ID game) dan kode SKU Digiflazz 
        // (Catatan: Idealnya disimpan ke database saat create-transaction, tapi untuk simpelnya bisa diurai dari kustom order_id atau mapping)
        const targetId = notification.customer_last_name; 
        const buyerSkuCode = "DIKODE_DARI_DATABASE_ATAU_MAPPING"; // Sesuaikan dengan SKU Digiflazz kamu

        const username = process.env.DIGIFLAZZ_USERNAME;
        const apiKey = process.env.DIGIFLAZZ_API_KEY;
        
        // Format Signature Digiflazz: username + api_key + ref_id
        const refId = orderId;
        const sign = md5(username + apiKey + refId);

        // Kirim HTTP POST ke Server Digiflazz
        try {
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

            const result = await digiflazzResponse.json();
            
            // Cek respon dari Digiflazz
            return res.status(200).json({ status: "Success processed to digiflazz", data: result });
        } catch (error) {
            return res.status(500).json({ message: "Gagal menembak API Digiflazz: " + error.message });
        }
    }

    return res.status(200).json({ message: "Notification ignored (not settlement)" });
}
