const crypto = require('crypto'); // Jika pakai Node.js, abaikan jika di browser (gunakan string MD5 langsung)

const username = process.env.DIGIFLAZZ_USERNAME;
const secretKey = process.env.DIGIFLAZZ_API_KEY;

// Generate sign MD5 (username + key)
const sign = crypto.createHash('md5').update(username + secretKey).digest('hex');

async function getProducts() {
  const url = "https://api.digiflazz.com/v1/price-list";
  
  const payload = {
    cmd: "prepaid", // atau "pasca" untuk pascabayar
    username: username,
    sign: sign
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log("Daftar Produk:", result);
  } catch (error) {
    console.error("Gagal mengambil data:", error);
  }
}

getProducts();
