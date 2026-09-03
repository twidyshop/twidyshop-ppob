export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const { targetId, productCode, price } = req.body;

        if (!targetId || !productCode || !price) {
            return res.status(400).json({ message: 'Target ID, Produk, dan Harga wajib diisi!' });
        }

        const orderId = 'TWIDY-' + Date.now();
        const amount = parseInt(price); 

        const midtransServerKey = process.env.MIDTRANS_SERVER_KEY;
        if (!midtransServerKey) {
            return res.status(500).json({ message: 'MIDTRANS_SERVER_KEY belum diset di Vercel!' });
        }

        const authString = Buffer.from(midtransServerKey + ':').toString('base64');

        const midtransResponse = await fetch('https://midtrans.com', {
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
                    last_name: targetId 
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
