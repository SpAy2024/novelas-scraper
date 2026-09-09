// scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const readline = require('readline');

const BASE_URL = 'https://ww2.ojearnovelas.com';
const DATA_DIR = './data';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

class NovelaScraper {
    constructor(novelaUrl, nombreNovela) {
        this.baseUrl = novelaUrl;
        this.nombreNovela = nombreNovela;
        this.capitulos = [];
    }

    static async preguntar(message) {
        return new Promise((resolve) => {
            rl.question(message, (answer) => {
                resolve(answer);
            });
        });
    }

    static async buscarNovelas(titulo) {
        try {
            console.log(`\n🔍 Buscando novelas con: "${titulo}"...`);
            const urlBusqueda = `${BASE_URL}/buscar/?q=${encodeURIComponent(titulo)}`;
            const response = await axios.get(urlBusqueda, { headers });
            const $ = cheerio.load(response.data);
            
            const resultados = [];
            $('.ani-card, .card, a[href*="/tunovela/"]').each((i, elemento) => {
                const enlace = $(elemento).attr('href');
                const tituloNovela = $(elemento).find('.ani-txt, .card-title, h3, h4').text().trim() || 
                                    $(elemento).text().trim();
                
                if (enlace && enlace.includes('/tunovela/') && tituloNovela) {
                    const urlCompleta = enlace.startsWith('http') ? enlace : BASE_URL + enlace;
                    if (!resultados.some(r => r.url === urlCompleta)) {
                        resultados.push({
                            titulo: tituloNovela,
                            url: urlCompleta
                        });
                    }
                }
            });
            
            return [...new Map(resultados.map(item => [item.url, item])).values()];
        } catch (error) {
            console.error('Error en búsqueda:', error.message);
            return [];
        }
    }

    async obtenerListaCapitulos() {
        try {
            console.log('📚 Obteniendo lista de capítulos...');
            const response = await axios.get(this.baseUrl, { headers });
            const $ = cheerio.load(response.data);
            
            const enlaces = [];
            $('.list-link').each((i, elemento) => {
                const enlace = $(elemento).attr('href');
                const titulo = $(elemento).text().trim();
                if (enlace && enlace.includes('/ojea/')) {
                    enlaces.push({
                        url: enlace.startsWith('http') ? enlace : BASE_URL + enlace,
                        titulo: titulo,
                        numero: this.extraerNumeroCapitulo(titulo)
                    });
                }
            });
            
            this.capitulos = enlaces.sort((a, b) => a.numero - b.numero);
            console.log(`✅ Encontrados ${this.capitulos.length} capítulos`);
            return this.capitulos;
        } catch (error) {
            console.error('Error:', error.message);
            return [];
        }
    }

    extraerNumeroCapitulo(titulo) {
        const match = titulo.match(/Capítulo\s*(\d+)/i);
        return match ? parseInt(match[1]) : 0;
    }

    async obtenerInfoCapitulo(capitulo) {
        try {
            console.log(`🎬 Procesando: Capítulo ${capitulo.numero}`);
            const response = await axios.get(capitulo.url, { headers });
            const $ = cheerio.load(response.data);
            
            const tituloCapitulo = $('h1.card-title').text().trim();
            const servidores = new Set();
            
            const scripts = $('script').toString();
            const urlPattern = /https?:\/\/[^\s"'<>]+\.(?:to|com|net|xyz)\/[^\s"'<>]+/g;
            const urlsEncontradas = scripts.match(urlPattern);
            
            if (urlsEncontradas) {
                urlsEncontradas.forEach(url => {
                    if (this.esServidorVideo(url)) servidores.add(url);
                });
            }
            
            $('iframe').each((i, el) => {
                const src = $(el).attr('src');
                if (src && this.esServidorVideo(src)) servidores.add(src);
            });
            
            return {
                numero: capitulo.numero,
                titulo: tituloCapitulo,
                url: capitulo.url,
                servidores: Array.from(servidores)
            };
        } catch (error) {
            console.error(`Error capítulo ${capitulo.numero}:`, error.message);
            return {
                numero: capitulo.numero,
                error: error.message,
                servidores: []
            };
        }
    }

    esServidorVideo(url) {
        const servidoresValidos = ['filemoon', 'iplayerhls', 'dooodster', 'luluvdo'];
        return servidoresValidos.some(servidor => url.toLowerCase().includes(servidor));
    }

    async obtenerTodosLosCapitulos(limite = null) {
        await this.obtenerListaCapitulos();
        if (this.capitulos.length === 0) return [];
        
        const capitulosAProcesar = limite ? this.capitulos.slice(0, limite) : this.capitulos;
        console.log(`\n🔄 Procesando ${capitulosAProcesar.length} capítulos...\n`);
        
        const resultados = [];
        for (const capitulo of capitulosAProcesar) {
            const info = await this.obtenerInfoCapitulo(capitulo);
            resultados.push(info);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
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
        
        await fs.writeFile(nombreArchivo, JSON.stringify(data, null, 2));
        console.log(`\n💾 Datos guardados en ${nombreArchivo}`);
        return nombreArchivo;
    }
}

async function main() {
    console.log('\n🌟 SCRAPER DE NOVELAS\n');
    console.log('1. Buscar por título');
    console.log('2. Usar URL directa');
    console.log('3. Salir\n');
    
    const opcion = await NovelaScraper.preguntar('Selecciona una opción (1-3): ');
    
    if (opcion === '3') {
        console.log('👋 ¡Hasta luego!');
        rl.close();
        return;
    }
    
    let novelaUrl = '', nombreNovela = '';
    
    if (opcion === '1') {
        const tituloBusqueda = await NovelaScraper.preguntar('\n📝 Título de la novela: ');
        const resultados = await NovelaScraper.buscarNovelas(tituloBusqueda);
        
        if (resultados.length === 0) {
            console.log('❌ No se encontraron novelas');
            rl.close();
            return;
        }
        
        console.log(`\n📋 Resultados:\n`);
        resultados.forEach((novela, index) => {
            console.log(`${index + 1}. ${novela.titulo}`);
        });
        
        const seleccion = await NovelaScraper.preguntar('\nSelecciona número: ');
        const novelaSeleccionada = resultados[parseInt(seleccion) - 1];
        novelaUrl = novelaSeleccionada.url;
        nombreNovela = novelaSeleccionada.titulo;
        
    } else if (opcion === '2') {
        novelaUrl = await NovelaScraper.preguntar('URL: ');
        nombreNovela = await NovelaScraper.preguntar('Nombre: ');
    }
    
    const limite = await NovelaScraper.preguntar('\n¿Cuántos capítulos? (Enter para todos): ');
    const limiteNum = limite === '' ? null : parseInt(limite);
    
    console.log(`\n🚀 Iniciando scraping de: ${nombreNovela}\n`);
    
    const scraper = new NovelaScraper(novelaUrl, nombreNovela);
    const resultados = await scraper.obtenerTodosLosCapitulos(limiteNum);
    
    console.log('\n📊 RESUMEN:');
    console.log(`Total: ${resultados.length} capítulos`);
    const conVideo = resultados.filter(c => c.servidores.length > 0).length;
    console.log(`Con video: ${conVideo} capítulos`);
    
    await scraper.guardarResultados(resultados);
    console.log('\n✅ ¡Proceso completado!');
    rl.close();
}

main().catch(error => {
    console.error('Error:', error);
    rl.close();
});