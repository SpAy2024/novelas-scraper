const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;

(async () => {
  const url = 'https://ojeonovelas.com/ver/sabor-a-ti-capitulo-1/';
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

  console.log('🌐 Descargando:', url);
  const { data } = await axios.get(url, { headers });

  // Guardar HTML crudo para inspeccionar
  await fs.writeFile('debug-capitulo-1.html', data);
  console.log('💾 HTML guardado en debug-capitulo-1.html (' + data.length + ' bytes)');

  const $ = cheerio.load(data);

  console.log('\n📊 Diagnóstico de selectores:');
  console.log('  h1.t1:', $('h1.t1').length);
  console.log('  h1:', $('h1').length);
  console.log('  button.tab:', $('button.tab').length);
  console.log('  button.tab[data-t="visor"]:', $('button.tab[data-t="visor"]').length);
  console.log('  button[data-u]:', $('button[data-u]').length);
  console.log('  .tab-list button:', $('.tab-list button').length);

  console.log('\n📋 Todos los <button> encontrados:');
  $('button').each((i, el) => {
    console.log(`  ${i + 1}. class="${$(el).attr('class') || ''}" data-t="${$(el).attr('data-t') || ''}" data-u="${($(el).attr('data-u') || '').substring(0, 20)}..." texto="${$(el).text().trim()}"`);
  });

  console.log('\n🔍 ¿Aparece "data-u" en el HTML crudo?', data.includes('data-u'));
  console.log('🔍 ¿Aparece "visor"?', data.includes('visor'));
  console.log('🔍 ¿Aparece "Bysejikuar"?', data.includes('Bysejikuar'));
  console.log('🔍 ¿Aparece "jhome.js"?', data.includes('jhome.js'));
})();