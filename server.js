// server.js - Versión con almacenamiento permanente en GitHub
const express = require('express');
const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = '55c0bb848e296dd8d81046079236067d';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';


// ============================================
// CONFIGURACIÓN FIREBASE (CORREGIDA)
// ============================================
let admin = null;
let db = null;
let firebaseInicializado = false;

try {
  // ✅ IMPORTACIÓN CORRECTA para firebase-admin v13+
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getDatabase } = require('firebase-admin/database');
  
  console.log('✅ firebase-admin cargado correctamente');
  
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no está configurada');
  }
  
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log('✅ JSON parseado correctamente');
  console.log('📋 project_id:', serviceAccount.project_id);
  
  // Inicializar solo si no está inicializado
  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: 'https://peliculasspay-default-rtdb.firebaseio.com/'
    });
  }
  
  db = getDatabase();
  firebaseInicializado = true;
  console.log('✅ Firebase inicializado correctamente');
  
} catch (error) {
  console.warn('⚠️ Firebase no disponible:', error.message);
  console.warn('⚠️ El servidor funcionará SOLO con GitHub');
  firebaseInicializado = false;
}
// ============================================
// FUNCIONES PARA FIREBASE
// ============================================
// ============================================
// FUNCIÓN PARA DETECTAR TEMPORADA
// ============================================
function detectarTemporada(nombre) {
  // Buscar números al final: "El Señor de los Cielos 7" → 7
  const match = nombre.match(/(\d+)\s*$/);
  if (match) return match[1];
  
  // Buscar "temporada X" o "season X"
  const matchTemp = nombre.match(/(?:temporada|season|parte|part)\s*(\d+)/i);
  if (matchTemp) return matchTemp[1];
  
  return "1"; // Por defecto, temporada 1
}



// Guardar en Firebase usando tmdb_id como clave
async function guardarEnFirebase(tmdbId, data) {
  if (!firebaseInicializado) {
    console.log('⚠️ Firebase no disponible, saltando guardado');
    return false;
  }
  try {
    const ref = db.ref(`novelas/${tmdbId}`);
    await ref.set(data);
    console.log(`✅ Guardado en Firebase: ${tmdbId}`);
    return true;
  } catch (error) {
    console.error('❌ Error en Firebase:', error.message);
    return false;
  }
}

// Leer de Firebase
async function leerDeFirebase(tmdbId) {
  if (!firebaseInicializado) return null;
  try {
    const ref = db.ref(`novelas/${tmdbId}`);
    const snapshot = await ref.once('value');
    return snapshot.val();
  } catch (error) {
    console.error('❌ Error leyendo Firebase:', error.message);
    return null;
  }
}

// Obtener todas las novelas de Firebase
async function listarNovelasFirebase() {
  if (!firebaseInicializado) return [];
  try {
    const ref = db.ref('novelas');
    const snapshot = await ref.once('value');
    const data = snapshot.val();
    
    if (!data) return [];
    
    return Object.keys(data).map(tmdbId => ({
      tmdb_id: tmdbId,
      ...data[tmdbId]
    }));
  } catch (error) {
    console.error('❌ Error listando Firebase:', error.message);
    return [];
  }
}


// Configurar GitHub
const octokit = new Octokit({ 
  auth: process.env.GITHUB_TOKEN 
});

const GITHUB_OWNER = 'SpAy2024';
const GITHUB_REPO = 'novelas-data';
const GITHUB_BRANCH = 'main';

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Headers CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// ============================================
// FUNCIONES AUXILIARES
// ============================================
// ========== NUEVO ENDPOINT PARA TMDB PROXY ==========
// ========== ENDPOINT TMDB CON ID ==========
app.get('/api/tmdb/poster', async (req, res) => {
    const { title } = req.query;
    
    if (!title) {
        return res.status(400).json({ error: 'Se requiere título' });
    }
    
    try {
        // Primero buscar en series (TV)
        const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=es`;
        const tvResponse = await axios.get(tvUrl);
        
        if (tvResponse.data.results && tvResponse.data.results.length > 0) {
            const result = tvResponse.data.results[0];
            const posterPath = result.poster_path;
            if (posterPath) {
                return res.json({ 
                    posterUrl: `${TMDB_IMAGE_BASE}${posterPath}`,
                    title: result.name,
                    tmdb_id: result.id,  // ← AGREGAR ESTO
                    type: 'tv'
                });
            }
        }
        
        // Si no encuentra en series, buscar en películas
        const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=es`;
        const movieResponse = await axios.get(movieUrl);
        
        if (movieResponse.data.results && movieResponse.data.results.length > 0) {
            const result = movieResponse.data.results[0];
            const posterPath = result.poster_path;
            if (posterPath) {
                return res.json({ 
                    posterUrl: `${TMDB_IMAGE_BASE}${posterPath}`,
                    title: result.title,
                    tmdb_id: result.id,  // ← AGREGAR ESTO
                    type: 'movie'
                });
            }
        }
        
        res.json({ posterUrl: null, tmdb_id: null });
        
    } catch (error) {
        console.error('Error en TMDB proxy:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// También agregar endpoint para obtener múltiples posters de una vez
app.post('/api/tmdb/posters', async (req, res) => {
    const { titles } = req.body;
    
    if (!titles || !Array.isArray(titles)) {
        return res.status(400).json({ error: 'Se requiere array de títulos' });
    }
    
    const results = {};
    
    for (const title of titles) {
        try {
            const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=es`;
            const tvResponse = await axios.get(tvUrl);
            
            if (tvResponse.data.results && tvResponse.data.results.length > 0) {
                const posterPath = tvResponse.data.results[0].poster_path;
                if (posterPath) {
                    results[title] = `${TMDB_IMAGE_BASE}${posterPath}`;
                    continue;
                }
            }
            
            const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=es`;
            const movieResponse = await axios.get(movieUrl);
            
            if (movieResponse.data.results && movieResponse.data.results.length > 0) {
                const posterPath = movieResponse.data.results[0].poster_path;
                if (posterPath) {
                    results[title] = `${TMDB_IMAGE_BASE}${posterPath}`;
                    continue;
                }
            }
            
            results[title] = null;
            
            // Pequeña pausa para no saturar la API
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            results[title] = null;
        }
    }
    
    res.json(results);
});





// Guardar archivo en GitHub
async function guardarEnGitHub(nombreArchivo, contenido) {
  try {
    let sha = null;
    try {
      const { data: existing } = await octokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: nombreArchivo,
        branch: GITHUB_BRANCH
      });
      sha = existing.sha;
    } catch (e) {}
    
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: nombreArchivo,
      message: `Actualizar ${nombreArchivo}`,
      content: Buffer.from(JSON.stringify(contenido, null, 2)).toString('base64'),
      branch: GITHUB_BRANCH,
      sha: sha
    });
    
    console.log(`✅ Guardado en GitHub: ${nombreArchivo}`);
    return true;
  } catch (error) {
    console.error('❌ Error guardando en GitHub:', error.message);
    return false;
  }
}

// Leer archivo de GitHub
async function leerDeGitHub(nombreArchivo) {
  try {
    const { data: content } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: nombreArchivo,
      branch: GITHUB_BRANCH
    });
    
    const jsonContent = Buffer.from(content.content, 'base64').toString();
    return JSON.parse(jsonContent);
  } catch (error) {
    return null;
  }
}

// Obtener lista de archivos de GitHub
async function listarArchivosGitHub() {
  try {
    const { data: files } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: '',
      branch: GITHUB_BRANCH
    });
    return files.filter(f => f.name.endsWith('_capitulos.json'));
  } catch (error) {
    return [];
  }
}

// Extraer número del capítulo
function extraerNumeroCapitulo(titulo) {
  const match = titulo.match(/Capítulo\s*(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

// Verificar si es servidor de video válido
function esServidorVideo(url) {
  const servidoresValidos = ['filemoon', 'iplayerhls', 'dooodster', 'luluvdo'];
  return servidoresValidos.some(servidor => url.toLowerCase().includes(servidor));
}

// ============================================
// ENDPOINTS API
// ============================================

// Obtener todas las novelas
app.get('/api/novelas', async (req, res) => {
  try {
    const files = await listarArchivosGitHub();
    const novelas = [];
    
    for (const file of files) {
      const data = await leerDeGitHub(file.name);
      if (data) {
        novelas.push({
          id: file.name.replace('_capitulos.json', ''),
          nombre: data.novela,
          total_capitulos: data.total_capitulos,
          fecha: data.fecha_extraccion
        });
      }
    }
    
    res.json(novelas);
  } catch (error) {
    console.error('Error:', error.message);
    res.json([]);
  }
});

// Obtener capítulos de una novela
app.get('/api/novela/:id/capitulos', async (req, res) => {
  try {
    const fileName = `${req.params.id}_capitulos.json`;
    const data = await leerDeGitHub(fileName);
    
    if (data) {
      res.json(data.capitulos);
    } else {
      res.status(404).json({ error: 'Novela no encontrada' });
    }
  } catch (error) {
    res.status(404).json({ error: 'Error al cargar' });
  }
});

// Buscar novelas en el sitio web
app.post('/api/buscar', async (req, res) => {
  const { titulo } = req.body;
  if (!titulo) {
    return res.status(400).json({ error: 'Se requiere título' });
  }
  
  console.log(`🔍 Buscando: "${titulo}"`);
  
  try {
    const urlBusqueda = `https://ww2.ojearnovelas.com/buscar/?q=${encodeURIComponent(titulo)}`;
    const response = await axios.get(urlBusqueda, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    const resultados = [];
    
    $('a[href*="/tunovela/"]').each((i, el) => {
      const href = $(el).attr('href');
      const texto = $(el).find('.ani-txt, .card-title').text().trim() || $(el).text().trim();
      if (href && texto && href.includes('/tunovela/')) {
        const urlCompleta = href.startsWith('http') ? href : 'https://ww2.ojearnovelas.com' + href;
        if (!resultados.some(r => r.url === urlCompleta)) {
          resultados.push({
            titulo: texto,
            url: urlCompleta
          });
        }
      }
    });
    
    console.log(`✅ Encontrados ${resultados.length} resultados`);
    res.json(resultados.slice(0, 20));
  } catch (error) {
    console.error('Error en búsqueda:', error.message);
    res.json([]);
  }
});


// Obtener novelas de Firebase
app.get('/api/firebase/novelas', async (req, res) => {
  try {
    const novelas = await listarNovelasFirebase();
    res.json(novelas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener capítulos por TMDB ID desde Firebase
app.get('/api/firebase/novela/:tmdbId/capitulos', async (req, res) => {
  try {
    const data = await leerDeFirebase(req.params.tmdbId);
    if (data) {
      res.json(data.capitulos);
    } else {
      res.status(404).json({ error: 'Novela no encontrada' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint unificado (intenta Firebase primero, luego GitHub)
app.get('/api/novela/:tmdbId/capitulos', async (req, res) => {
  try {
    // Primero buscar en Firebase
    let data = await leerDeFirebase(req.params.tmdbId);
    
    // Si no está en Firebase, buscar en GitHub
    if (!data) {
      const fileName = `${req.params.tmdbId}_capitulos.json`;
      data = await leerDeGitHub(fileName);
    }
    
    if (data) {
      res.json(data.capitulos);
    } else {
      res.status(404).json({ error: 'Novela no encontrada' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Iniciar scraping
// ============================================
// ENDPOINT SCRAPE CON TEMPORADAS
// ============================================
app.post('/api/scrape', async (req, res) => {
  const { url, nombre, limite, tmdb_id } = req.body;
  
  // TMDB ID es OBLIGATORIO
  if (!url || !nombre || !tmdb_id) {
    return res.status(400).json({ 
      error: 'Se requiere URL, nombre y tmdb_id (obligatorio)' 
    });
  }
  
  const tmdbIdFinal = parseInt(tmdb_id);
  const temporada = detectarTemporada(nombre);
  
  console.log(`\n🚀 Iniciando scraping de: ${nombre}`);
  console.log(`🆔 TMDB ID (manual): ${tmdbIdFinal}`);
  console.log(`📺 Temporada detectada: ${temporada}`);
  
  try {
    // ========== OBTENER POSTER DE TMDB ==========
    let tmdb_poster = null;
    
    try {
      const tvUrl = `https://api.themoviedb.org/3/tv/${tmdbIdFinal}?api_key=${TMDB_API_KEY}&language=es`;
      const tvResponse = await axios.get(tvUrl);
      
      if (tvResponse.data && tvResponse.data.poster_path) {
        tmdb_poster = `${TMDB_IMAGE_BASE}${tvResponse.data.poster_path}`;
        console.log(`🖼️ Poster obtenido: ${tmdb_poster}`);
      }
    } catch (error) {
      try {
        const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbIdFinal}?api_key=${TMDB_API_KEY}&language=es`;
        const movieResponse = await axios.get(movieUrl);
        
        if (movieResponse.data && movieResponse.data.poster_path) {
          tmdb_poster = `${TMDB_IMAGE_BASE}${movieResponse.data.poster_path}`;
        }
      } catch (e) {
        console.warn('⚠️ No se pudo obtener poster de TMDB');
      }
    }
    
    // ========== LEER DATOS EXISTENTES DE FIREBASE ==========
    let datosExistentes = await leerDeFirebase(tmdbIdFinal.toString());
    
    if (!datosExistentes) {
      // Si no existe, crear estructura base
      datosExistentes = {
        novela: nombre.replace(/\s+\d+\s*$/, '').trim(), // Quitar número al final
        tmdb_id: tmdbIdFinal,
        poster: tmdb_poster,
        temporadas: {}
      };
      console.log('📝 Creando nueva estructura en Firebase');
    } else {
      console.log('📂 Estructura existente encontrada');
      console.log(`📺 Temporadas existentes: ${Object.keys(datosExistentes.temporadas || {}).join(', ') || 'ninguna'}`);
      
      // Actualizar poster si no existe
      if (!datosExistentes.poster && tmdb_poster) {
        datosExistentes.poster = tmdb_poster;
      }
    }
    
    // Inicializar temporadas si no existe
    if (!datosExistentes.temporadas) {
      datosExistentes.temporadas = {};
    }
    
    // ========== OBTENER CAPÍTULOS ==========
    console.log('📚 Obteniendo lista de capítulos...');
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(response.data);
    
    const capitulos = [];
    $('.list-link').each((i, el) => {
      const enlace = $(el).attr('href');
      const texto = $(el).text().trim();
      if (enlace && enlace.includes('/ojea/')) {
        capitulos.push({
          url: enlace.startsWith('http') ? enlace : 'https://ww2.ojearnovelas.com' + enlace,
          numero: extraerNumeroCapitulo(texto)
        });
      }
    });
    
    capitulos.sort((a, b) => a.numero - b.numero);
    console.log(`✅ Encontrados ${capitulos.length} capítulos`);
    
    const limiteNum = limite ? parseInt(limite) : null;
    const procesar = limiteNum ? capitulos.slice(0, limiteNum) : capitulos;
    
    console.log(`🔄 Procesando ${procesar.length} capítulos...`);
    
    // Procesar cada capítulo
    const resultados = [];
    for (let i = 0; i < procesar.length; i++) {
      const cap = procesar[i];
      console.log(`🎬 Procesando capítulo ${cap.numero} (${i+1}/${procesar.length})`);
      
      try {
        const resCap = await axios.get(cap.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $$ = cheerio.load(resCap.data);
        
        const servidores = new Set();
        const scripts = $$('script').toString();
        const urlPattern = /https?:\/\/[^\s"'<>]+\.(?:to|com|net|xyz)\/[^\s"'<>]+/g;
        const urlsEncontradas = scripts.match(urlPattern);
        
        if (urlsEncontradas) {
          urlsEncontradas.forEach(u => {
            if (esServidorVideo(u)) {
              servidores.add(u);
            }
          });
        }
        
        $$('iframe').each((i, el) => {
          const src = $$(el).attr('src');
          if (src && esServidorVideo(src)) servidores.add(src);
        });
        
        resultados.push({
          numero: cap.numero,
          titulo: $$('h1.card-title').text().trim(),
          url: cap.url,
          servidores: Array.from(servidores)
        });
        
      } catch (error) {
        console.log(`❌ Error capítulo ${cap.numero}: ${error.message}`);
        resultados.push({
          numero: cap.numero,
          error: error.message,
          servidores: []
        });
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
    
    // ========== AGREGAR TEMPORADA A LA ESTRUCTURA ==========
    datosExistentes.temporadas[temporada] = {
      titulo: nombre,
      fecha_extraccion: new Date().toISOString(),
      total_capitulos: resultados.length,
      url: url,
      capitulos: resultados
    };
    
    // Actualizar poster si es necesario
    if (tmdb_poster) {
      datosExistentes.poster = tmdb_poster;
    }
    
    // Calcular total de temporadas y capítulos
    const totalTemporadas = Object.keys(datosExistentes.temporadas).length;
    const totalCapitulos = Object.values(datosExistentes.temporadas)
      .reduce((sum, t) => sum + (t.total_capitulos || 0), 0);
    
    datosExistentes.total_temporadas = totalTemporadas;
    datosExistentes.total_capitulos = totalCapitulos;
    
    // ========== GUARDAR EN GITHUB ==========
    const fileName = `${tmdbIdFinal}_capitulos.json`;
    await guardarEnGitHub(fileName, datosExistentes);
    
    // ========== GUARDAR EN FIREBASE ==========
    await guardarEnFirebase(tmdbIdFinal.toString(), datosExistentes);
    
    console.log(`✅ Scraping completado: ${resultados.length} capítulos guardados`);
    console.log(`📺 Temporada ${temporada} agregada`);
    console.log(`📊 Total: ${totalTemporadas} temporadas, ${totalCapitulos} capítulos`);
    
    res.json({ 
      success: true, 
      message: `Temporada ${temporada} agregada correctamente`,
      tmdb_id: tmdbIdFinal,
      temporada: temporada,
      total_temporadas: totalTemporadas,
      total_capitulos: totalCapitulos
    });
    
  } catch (error) {
    console.error('❌ Error en scraping:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`✅ Servidor funcionando correctamente`);
  console.log(`📡 Puerto: ${PORT}`);
  console.log(`🌐 Accede a: http://localhost:${PORT}`);
  console.log(`========================================\n`);
});