const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  const url = 'https://ojeonovelas.com/ver/sabor-a-ti-capitulo-1/';
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const $ = cheerio.load(data);

  console.log('🎬 Título:', $('h1.t1').text().trim());
  console.log('\n📡 Servidores encontrados:\n');

  $('button.tab[data-t="visor"]').each((i, el) => {
    const nombre = $(el).text().trim();
    const dataU = $(el).attr('data-u');
    if (!dataU) return;
    try {
      const invertido = dataU.split('').reverse().join('');
      const urlDecodificada = Buffer.from(invertido, 'base64').toString('utf-8');
      console.log(`${i + 1}. ${nombre}`);
      console.log(`   → ${urlDecodificada}\n`);
    } catch (e) {
      console.log(`${i + 1}. ${nombre} → ❌ error: ${e.message}`);
    }
  });
})();