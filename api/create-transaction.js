const crypto = require('crypto');

export default async function handler(req, res) {
    // CORS headers agar bisa diakses dari frontend web kamu
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const { targetId, productCode } = req.body;

        if (!targetId || !productCode) {
            return res.status(400).json({ message: 'Target ID dan Product Code wajib diisi!' });
        }

        const orderId = 'TWIDY-' + Date.now();
        const amount = 10000; // Sesuaikan harga produk kamu (contoh: 10000)

        // Konfigurasi Midtrans Server Key dari Environment Variables Vercel
        const midtransServerKey = process.env.MIDTRANS_SERVER_KEY;
        if (!midtransServerKey) {
            return res.status(500).json({ message: 'MIDTRANS_SERVER_KEY belum diset di Vercel!' });
        }

        const authString = Buffer.from(midtransServerKey + ':').toString('base64');

        // Request token SNAP ke Midtrans
        const midtransResponse = await fetch('https://app.sandbox.midtrans.com/snap/v1/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Basic ${authString}`
            },
            body: JSON.stringify({
                transaction_details: {
                    order_id: orderId,
                    gross_amount: amount
                },
                customer_details: {
                    first_name: "Customer",
                    last_name: targetId // Kita simpan targetID/No HP di sini agar terbaca di webhook
                },
                item_details: [{
                    id: productCode,
                    price: amount,
                    quantity: 1,
                    name: `Top Up ${productCode}`
                }]
            })
        });

        const midtransData = await midtransResponse.json();

        if (!midtransResponse.ok) {
            return res.status(400).json({ message: 'Gagal membuat transaksi Midtrans', error: midtransData });
        }

        return res.status(200).json({
            token: midtransData.token,
            redirect_url: midtransData.redirect_url,
            order_id: orderId
        });

    } catch (error) {
        return res.status(500).json({ message: 'Server error: ' + error.message });
    }
}
