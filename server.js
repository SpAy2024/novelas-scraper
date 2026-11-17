const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = './data';
const BASE_SITE = 'https://ojeonovelas.com';

const TMDB_API_KEY = '55c0bb848e296dd8d81046079236067d';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// ============================================
// CONFIGURACIÓN DE FIREBASE
// ============================================
let admin = null;
let db = null;
let firebaseInicializado = false;

try {
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getDatabase } = require('firebase-admin/database');

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount),
        databaseURL: 'https://peliculasspay-default-rtdb.firebaseio.com/'
      });
    }
    db = getDatabase();
    firebaseInicializado = true;
    console.log('✅ Firebase inicializado correctamente');
  } else {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT no configurada.');
  }
} catch (error) {
  console.warn('⚠️ Firebase no disponible:', error.message);
}

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ============================================
// FUNCIONES FIREBASE Y JSON
// ============================================
async function guardarEnFirebase(tmdbId, data) {
  if (!firebaseInicializado) return false;
  try {
    await db.ref(`novelas/${tmdbId}`).set(data);
    return true;
  } catch (error) {
    return false;
  }
}

async function leerDeFirebase(tmdbId) {
  if (!firebaseInicializado) return null;
  try {
    const snapshot = await db.ref(`novelas/${tmdbId}`).once('value');
    return snapshot.val();
  } catch (error) {
    return null;
  }
}

async function listarNovelasFirebase() {
  if (!firebaseInicializado) return [];
  try {
    const snapshot = await db.ref('novelas').once('value');
    const data = snapshot.val();
    if (!data) return [];
    return Object.keys(data).map(id => ({ id, ...data[id] }));
  } catch (error) {
    return [];
  }
}

async function leerJSONLocal(nombreArchivo) {
  try {
    const data = await fs.readFile(path.join(DATA_DIR, nombreArchivo), 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

// ============================================
// ENDPOINTS TMDB (PARA LAS IMÁGENES)
// ============================================
app.post('/api/tmdb/posters', async (req, res) => {
  const { titles } = req.body;
  if (!titles || !Array.isArray(titles)) return res.status(400).json({ error: 'Faltan títulos' });

  const results = {};
  for (const title of titles) {
    try {
      const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=es`;
      const tvResponse = await axios.get(tvUrl);

      if (tvResponse.data.results && tvResponse.data.results.length > 0 && tvResponse.data.results[0].poster_path) {
        results[title] = `${TMDB_IMAGE_BASE}${tvResponse.data.results[0].poster_path}`;
      } else {
        const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=es`;
        const movieResponse = await axios.get(movieUrl);
        if (movieResponse.data.results && movieResponse.data.results.length > 0 && movieResponse.data.results[0].poster_path) {
          results[title] = `${TMDB_IMAGE_BASE}${movieResponse.data.results[0].poster_path}`;
        } else {
          results[title] = null;
        }
      }
    } catch (error) {
      results[title] = null;
    }
  }
  res.json(results);
});

// ============================================
// ENDPOINTS PÚBLICOS
// ============================================
app.get('/api/novelas', async (req, res) => {
  try {
    let novelas = await listarNovelasFirebase();
    
    if (novelas.length === 0) {
      const files = await fs.readdir(DATA_DIR).catch(() => []);
      for (const file of files) {
        if (file.endsWith('_capitulos.json')) {
          const data = await leerJSONLocal(file);
          if (data) {
            novelas.push({
              id: file.replace('_capitulos.json', ''),
              nombre: data.novela,
              total_capitulos: data.total_capitulos,
              fecha: data.fecha_extraccion
            });
          }
        }
      }
    }
    res.json(novelas);
  } catch (error) {
    res.json([]);
  }
});

app.get('/api/novela/:id/capitulos', async (req, res) => {
  try {
    let data = await leerDeFirebase(req.params.id);
    if (!data) data = await leerJSONLocal(`${req.params.id}_capitulos.json`);
    if (!data) return res.status(404).json({ error: 'No encontrada' });

    // ✅ ESTO ES LO QUE ARREGLA EL MODAL "undefined"
    // Le damos el formato exacto que tu frontend espera.
    const respuesta = {
      novela: data.novela,
      total_temporadas: 1,
      total_capitulos: data.total_capitulos,
      temporadas: {
        "temp_1": {
          numero: 1,
          titulo: "Temporada 1",
          total_capitulos: data.capitulos ? data.capitulos.length : 0,
          capitulos: data.capitulos || []
        }
      }
    };
    res.json(respuesta);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SCRAPING CON PUPPETEER
// ============================================
app.post('/api/scrape', async (req, res) => {
  const { url, nombre, limite, tmdb_id } = req.body;
  if (!url || !nombre || !tmdb_id) return res.status(400).json({ error: 'Faltan datos' });

  console.log(`\n🚀 Iniciando scraping de: ${nombre}`);
  let browser = null;

  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const matchSlug = url.match(/\/novela\/([^\/]+)/);
    if (!matchSlug) throw new Error('URL inválida');
    const slug = matchSlug[1];

    let capitulosEncontrados = [];
    let fallosConsecutivos = 0;
    let numero = 1;

    while (fallosConsecutivos < 3 && numero <= 200) {
      const urlCap = `${BASE_SITE}/ver/${slug}-capitulo-${numero}/`;
      try {
        const response = await page.goto(urlCap, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (response.status() === 200) {
          const titulo = await page.evaluate(() => document.querySelector('h1.t1')?.textContent.trim() || '');
          if (titulo.toLowerCase().includes('capítulo')) {
            capitulosEncontrados.push({ numero, url: urlCap });
            fallosConsecutivos = 0;
          } else { throw new Error('No es capítulo'); }
        } else { throw new Error('Status no es 200'); }
      } catch (e) {
        fallosConsecutivos++;
      }
      numero++;
      await new Promise(r => setTimeout(r, 300));
    }

    const limiteNum = limite ? parseInt(limite) : null;
    const procesar = limiteNum ? capitulosEncontrados.slice(0, limiteNum) : capitulosEncontrados;

    const resultados = [];
    for (let i = 0; i < procesar.length; i++) {
      const cap = procesar[i];
      try {
        await page.goto(cap.url, { waitUntil: 'networkidle2', timeout: 60000 });
        try { await page.waitForSelector('button[data-u]', { timeout: 10000 }); } catch (e) {}

        const info = await page.evaluate(() => {
          const tituloDOM = document.querySelector('h1.t1')?.textContent.trim() || '';
          const servidores = [];
          document.querySelectorAll('button[data-u]').forEach(btn => {
            const nombre = btn.textContent.trim();
            const dataU = btn.getAttribute('data-u');
            if (!dataU) return;
            try {
              const base64Decodificado = atob(dataU); 
              const urlFinal = base64Decodificado.split('').reverse().join('');
              if (urlFinal.startsWith('http')) servidores.push({ nombre, url: urlFinal });
            } catch (e) {}
          });
          return { titulo: tituloDOM, servidores };
        });

        resultados.push({
          numero: cap.numero,
          titulo: info.titulo || `Capítulo ${cap.numero}`,
          url: cap.url,
          servidores: info.servidores
        });
      } catch (error) {
        resultados.push({ numero: cap.numero, error: error.message, servidores: [] });
      }
      await new Promise(r => setTimeout(r, 500));
    }

    await browser.close();

    const datosFinales = {
      novela: nombre,
      tmdb_id: parseInt(tmdb_id),
      total_capitulos: resultados.length,
      fecha_extraccion: new Date().toISOString(),
      capitulos: resultados // <-- Aquí se guarda la lista
    };

    await guardarEnFirebase(tmdb_id, datosFinales);
    res.json({ success: true, message: `Scraping completado: ${resultados.length} capítulos` });

  } catch (error) {
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ Servidor listo en http://localhost:${PORT}\n`);
});