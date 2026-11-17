const puppeteer = require('puppeteer');

(async () => {
  console.log('🚀 Iniciando navegador real (Puppeteer)...');
  
  // headless: false abre una ventana visible, útil para ver qué pasa
  const browser = await puppeteer.launch({ 
    headless: 'new',
    defaultViewport: null
  });

  try {
    const page = await browser.newPage();
    
    // Ir a la página esperando a que la red se calme (así carga el video/caché)
    console.log('🌐 Navegando a la página...');
    await page.goto('https://ojeonovelas.com/ver/sabor-a-ti-capitulo-1/', {
      waitUntil: 'networkidle2',
      timeout: 60000 // 60 segundos de margen por si el sitio está lento
    });

    console.log('✅ Página cargada. Extrayendo servidores...');

    // Extraer los datos directamente del DOM
    const servidores = await page.evaluate(() => {
      const lista = [];
      document.querySelectorAll('button.tab[data-t="visor"]').forEach(btn => {
        const nombre = btn.textContent.trim();
        const dataU = btn.getAttribute('data-u');
        if (!dataU) return;
        try {
          const invertido = dataU.split('').reverse().join('');
          const url = atob(invertido);
          if (url.startsWith('http')) {
            lista.push({ nombre, url });
          }
        } catch (e) {}
      });
      return lista;
    });

    if (servidores.length === 0) {
      console.log('⚠️ No se encontraron servidores. Puede que el sitio siga caído o haya cambiado.');
    } else {
      console.log(`\n📡 Total servidores encontrados: ${servidores.length}\n`);
      servidores.forEach(srv => {
        console.log(`🔎 ${srv.nombre}:`);
        console.log(`   → ${srv.url}\n`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
    console.log('🛑 Navegador cerrado.');
  }
})();