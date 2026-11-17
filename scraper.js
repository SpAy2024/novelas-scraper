const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const readline = require('readline');

const BASE_URL = 'https://ojeonovelas.com';
const DATA_DIR = './data';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

class NovelaScraper {
    constructor(novelaUrl, nombreNovela) {
        this.baseUrl = novelaUrl;
        this.nombreNovela = nombreNovela;
        this.capitulos = [];
        this.browser = null;
    }

    static async preguntar(message) {
        return new Promise((resolve) => {
            rl.question(message, (answer) => {
                resolve(answer);
            });
        });
    }

    async iniciarNavegador() {
        console.log('🚀 Iniciando navegador (Puppeteer)...');
       this.browser = await puppeteer.launch({ 
    headless: 'new',
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
    ]
});
    }

    async cerrarNavegador() {
        if (this.browser) {
            await this.browser.close();
            console.log('🛑 Navegador cerrado.');
        }
    }

       

      async obtenerListaCapitulos() {
        try {
            console.log('📚 Generando lista de capítulos automáticamente...');
            
            // Extraer el "slug" de la URL (ej. sabor-a-ti)
            const matchSlug = this.baseUrl.match(/\/novela\/([^\/]+)/);
            if (!matchSlug) {
                console.error('❌ No se pudo identificar el nombre de la novela en la URL.');
                return [];
            }
            const slug = matchSlug[1]; 
            console.log(`🔗 Slug identificado: ${slug}`);

            const page = await this.browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Vamos a probar capítulos del 1 al 200 (por si acaso hay muchos)
            // Se detendrá automáticamente cuando encuentre 3 capítulos seguidos que no existan (error 404)
            let fallosConsecutivos = 0;
            const maxFallos = 3;
            let numero = 1;
            const capitulosEncontrados = [];

            while (fallosConsecutivos < maxFallos && numero <= 200) {
                const urlCapitulo = `${BASE_URL}/ver/${slug}-capitulo-${numero}/`;
                
                try {
                    // Hacemos una petición rápida (no esperamos a que cargue todo, solo si existe)
                    const response = await page.goto(urlCapitulo, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    
                    // Si la página carga y tiene el título de la novela, el capítulo existe
                    if (response.status() === 200) {
                        const titulo = await page.evaluate(() => document.querySelector('h1.t1')?.textContent.trim() || '');
                        
                        // Si el título contiene la palabra "Capítulo", es válido
                        if (titulo.toLowerCase().includes('capítulo') || titulo.toLowerCase().includes('capitulo')) {
                            capitulosEncontrados.push({
                                numero: numero,
                                titulo: titulo,
                                url: urlCapitulo
                            });
                            console.log(`  ✅ Capítulo ${numero} encontrado`);
                            fallosConsecutivos = 0; // Reiniciar contador de fallos
                        } else {
                            throw new Error('No es un capítulo válido');
                        }
                    } else {
                        throw new Error('Status no es 200');
                    }
                } catch (e) {
                    fallosConsecutivos++;
                    // Silenciamos el log para no llenar la pantalla de errores
                }

                numero++;
                // Pausa de cortesía para no saturar el servidor
                await new Promise(r => setTimeout(r, 300));
            }

            await page.close();
            this.capitulos = capitulosEncontrados;
            console.log(`✅ Total capítulos encontrados: ${this.capitulos.length}`);
            return this.capitulos;

        } catch (error) {
            console.error('Error obteniendo lista:', error.message);
            return [];
        }
    }

  
          async obtenerInfoCapitulo(capitulo) {
        const page = await this.browser.newPage();
        try {
            console.log(`🎬 Procesando: Capítulo ${capitulo.numero}`);
            
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            await page.goto(capitulo.url, { waitUntil: 'networkidle2', timeout: 60000 });

            try {
                await page.waitForSelector('button[data-u]', { timeout: 15000 });
            } catch (e) {}

            const info = await page.evaluate(() => {
                const tituloDOM = document.querySelector('h1.t1')?.textContent.trim() || document.title;
                const servidores = [];
                
                document.querySelectorAll('button[data-u]').forEach(btn => {
                    const nombre = btn.textContent.trim();
                    const dataU = btn.getAttribute('data-u');
                    if (!dataU) return;
                    
                    try {
                        // 🔥 EL ORDEN CORRECTO SEGÚN jhome.js:
                        // 1. Decodificar Base64
                        // 2. Invertir el texto
                        const base64Decodificado = atob(dataU); 
                        const urlFinal = base64Decodificado.split('').reverse().join('');
                        
                        if (urlFinal.startsWith('http')) {
                            servidores.push({ nombre, url: urlFinal });
                        }
                    } catch (e) {
                        // Si falla atob, probar con Buffer (por si acaso)
                        try {
                            const base64Decodificado = Buffer.from(dataU, 'base64').toString('utf-8');
                            const urlFinal = base64Decodificado.split('').reverse().join('');
                            if (urlFinal.startsWith('http')) {
                                servidores.push({ nombre, url: urlFinal });
                            }
                        } catch (e2) {}
                    }
                });

                return { titulo: tituloDOM, servidores };
            });

            await page.close();
            
            if (info.servidores.length > 0) {
                console.log(`  ✅ ${info.servidores.length} servidores encontrados`);
            } else {
                console.log(`  ❌ Sin servidores`);
            }

            return {
                numero: capitulo.numero,
                titulo: info.titulo,
                url: capitulo.url,
                servidores: info.servidores
            };
        } catch (error) {
            await page.close();
            console.error(`  ❌ Error en capítulo ${capitulo.numero}:`, error.message);
            return {
                numero: capitulo.numero,
                titulo: capitulo.titulo,
                url: capitulo.url,
                error: error.message,
                servidores: []
            };
        }
    }
    
   

    async obtenerTodosLosCapitulos(limite = null) {
        await this.iniciarNavegador();
        
        await this.obtenerListaCapitulos();
        if (this.capitulos.length === 0) {
            await this.cerrarNavegador();
            return [];
        }

        const capitulosAProcesar = limite ? this.capitulos.slice(0, limite) : this.capitulos;
        console.log(`\n🔄 Procesando ${capitulosAProcesar.length} capítulos...\n`);

        const resultados = [];
        for (const capitulo of capitulosAProcesar) {
            const info = await this.obtenerInfoCapitulo(capitulo);
            resultados.push(info);
            // Pausa de cortesía para no saturar el sitio
            await new Promise(resolve => setTimeout(resolve, 1000)); 
        }

        await this.cerrarNavegador();
        return resultados;
    }

    async guardarResultados(resultados) {
        try {
            await fs.access(DATA_DIR);
        } catch {
            await fs.mkdir(DATA_DIR, { recursive: true });
        }

        const nombreArchivo = `${DATA_DIR}/${this.nombreNovela.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_capitulos.json`;

        const data = {
            novela: this.nombreNovela,
            url: this.baseUrl,
            fecha_extraccion: new Date().toISOString(),
            total_capitulos: resultados.length,
            capitulos: resultados
        };

        // Guardar asegurando UTF-8
        await fs.writeFile(nombreArchivo, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`\n💾 Datos guardados en ${nombreArchivo}`);
        return nombreArchivo;
    }
}

async function main() {
    console.log('\n🌟 SCRAPER DE NOVELAS (ojeonovelas.com) - MODO PUPPETEER\n');
    console.log('1. Buscar por título (No implementado en esta versión)');
    console.log('2. Usar URL directa');
    console.log('3. Salir\n');

    const opcion = await NovelaScraper.preguntar('Selecciona una opción (1-3): ');

    if (opcion === '3') {
        console.log('👋 ¡Hasta luego!');
        rl.close();
        return;
    }

    let novelaUrl = '', nombreNovela = '';

    if (opcion === '2') {
        novelaUrl = await NovelaScraper.preguntar('URL (ej. https://ojeonovelas.com/novela/sabor-a-ti/): ');
        nombreNovela = await NovelaScraper.preguntar('Nombre: ');
    } else {
        console.log('Por ahora usa la opción 2 (URL directa).');
        rl.close();
        return;
    }

    const limite = await NovelaScraper.preguntar('\n¿Cuántos capítulos? (Enter para todos): ');
    const limiteNum = limite === '' ? null : parseInt(limite);

    console.log(`\n🚀 Iniciando scraping de: ${nombreNovela}\n`);

    const scraper = new NovelaScraper(novelaUrl, nombreNovela);
    const resultados = await scraper.obtenerTodosLosCapitulos(limiteNum);

    console.log('\n📊 RESUMEN:');
    console.log(`Total: ${resultados.length} capítulos`);
    const conVideo = resultados.filter(c => c.servidores && c.servidores.length > 0).length;
    console.log(`Con servidores de video: ${conVideo} capítulos`);

    if (resultados.length > 0) {
        await scraper.guardarResultados(resultados);
    }
    
    console.log('\n✅ ¡Proceso completado!');
    rl.close();
}

main().catch(error => {
    console.error('Error:', error);
    rl.close();
});