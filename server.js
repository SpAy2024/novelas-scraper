// server.js - Versión con almacenamiento permanente en GitHub + Firebase
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
// CONFIGURACIÓN FIREBASE
// ============================================
let admin = null;
let db = null;
let firebaseInicializado = false;

try {
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getDatabase } = require('firebase-admin/database');

  console.log('✅ firebase-admin cargado correctamente');

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no está configurada');
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log('✅ JSON parseado correctamente');
  console.log('📋 project_id:', serviceAccount.project_id);

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
// CONFIGURACIÓN GITHUB
// ============================================
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const GITHUB_OWNER = 'SpAy2024';
const GITHUB_REPO = 'novelas-data';
const GITHUB_BRANCH = 'main';

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.static('.'));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// ============================================
// FUNCIONES FIREBASE
// ============================================
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

// ============================================
// FUNCIONES GITHUB
// ============================================
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

// ============================================
// FUNCIONES AUXILIARES
// ============================================
function detectarTemporada(nombre) {
  const match = nombre.match(/(\d+)\s*$/);
  if (match) return match[1];
  const matchTemp = nombre.match(/(?:temporada|season|parte|part)\s*(\d+)/i);
  if (matchTemp) return matchTemp[1];
  return "1";
}

function extraerNumeroCapitulo(titulo) {
  const match = titulo.match(/Capítulo\s*(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

function esServidorVideo(url) {
  const servidoresValidos = ['filemoon', 'iplayerhls', 'dooodster', 'luluvdo'];
  return servidoresValidos.some(servidor => url.toLowerCase().includes(servidor));
}

// ============================================
// ENDPOINTS TMDB
// ============================================
app.get('/api/tmdb/poster', async (req, res) => {
  const { title } = req.query;
  if (!title) return res.status(400).json({ error: 'Se requiere título' });

  try {
    const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=es`;
    const tvResponse = await axios.get(tvUrl);

    if (tvResponse.data.results && tvResponse.data.results.length > 0) {
      const result = tvResponse.data.results[0];
      if (result.poster_path) {
        return res.json({
          posterUrl: `${TMDB_IMAGE_BASE}${result.poster_path}`,
          title: result.name,
          tmdb_id: result.id,
          type: 'tv'
        });
      }
    }

    const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=es`;
    const movieResponse = await axios.get(movieUrl);

    if (movieResponse.data.results && movieResponse.data.results.length > 0) {
      const result = movieResponse.data.results[0];
      if (result.poster_path) {
        return res.json({
          posterUrl: `${TMDB_IMAGE_BASE}${result.poster_path}`,
          title: result.title,
          tmdb_id: result.id,
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
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      results[title] = null;
    }
  }

  res.json(results);
});

// ============================================
// ENDPOINTS ADMIN
// ============================================
app.post('/api/admin/novela', async (req, res) => {
  const { tmdb_id, nombre, poster, url } = req.body;
  if (!tmdb_id || !nombre) {
    return res.status(400).json({ error: 'Se requiere tmdb_id y nombre' });
  }

  try {
    let datos = await leerDeFirebase(tmdb_id.toString()) || {
      novela: nombre,
      tmdb_id: parseInt(tmdb_id),
      poster: poster || null,
      url: url || null,
      temporadas: {},
      fecha_creacion: new Date().toISOString()
    };

    datos.novela = nombre;
    if (poster) datos.poster = poster;
    if (url) datos.url = url;
    datos.fecha_actualizacion = new Date().toISOString();

    await guardarEnGitHub(`${tmdb_id}_capitulos.json`, datos);
    await guardarEnFirebase(tmdb_id.toString(), datos);

    res.json({ success: true, message: 'Novela guardada', data: datos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/capitulo', async (req, res) => {
  const { tmdb_id, temporada, numero, titulo, url, servidores } = req.body;
  if (!tmdb_id || !temporada || !numero) {
    return res.status(400).json({ error: 'Se requiere tmdb_id, temporada y número' });
  }

  try {
    const datos = await leerDeFirebase(tmdb_id.toString());
    if (!datos) return res.status(404).json({ error: 'Novela no encontrada' });

    if (!datos.temporadas) datos.temporadas = {};
    const tempKey = `temp_${temporada}`;
    if (!datos.temporadas[tempKey]) {
      datos.temporadas[tempKey] = {
        numero: parseInt(temporada),
        titulo: `Temporada ${temporada}`,
        fecha_extraccion: new Date().toISOString(),
        total_capitulos: 0,
        capitulos: []
      };
    }

    const temp = datos.temporadas[tempKey];
    const capIndex = temp.capitulos.findIndex(c => c.numero === parseInt(numero));

    const nuevoCap = {
      numero: parseInt(numero),
      titulo: titulo || `Capítulo ${numero}`,
      url: url || '',
      servidores: servidores || []
    };

    if (capIndex >= 0) {
      temp.capitulos[capIndex] = { ...temp.capitulos[capIndex], ...nuevoCap };
    } else {
      temp.capitulos.push(nuevoCap);
      temp.capitulos.sort((a, b) => a.numero - b.numero);
    }

    temp.total_capitulos = temp.capitulos.length;

    datos.total_temporadas = Object.keys(datos.temporadas).length;
    datos.total_capitulos = Object.values(datos.temporadas)
      .reduce((sum, t) => sum + t.capitulos.length, 0);
    datos.fecha_actualizacion = new Date().toISOString();

    await guardarEnGitHub(`${tmdb_id}_capitulos.json`, datos);
    await guardarEnFirebase(tmdb_id.toString(), datos);

    res.json({ success: true, message: 'Capítulo guardado', data: datos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/capitulo', async (req, res) => {
  const { tmdb_id, temporada, numero } = req.body;

  try {
    const datos = await leerDeFirebase(tmdb_id.toString());
    const tempKey = `temp_${temporada}`;

    if (!datos || !datos.temporadas || !datos.temporadas[tempKey]) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const temp = datos.temporadas[tempKey];
    temp.capitulos = temp.capitulos.filter(c => c.numero !== parseInt(numero));
    temp.total_capitulos = temp.capitulos.length;

    datos.total_temporadas = Object.keys(datos.temporadas).length;
    datos.total_capitulos = Object.values(datos.temporadas)
      .reduce((sum, t) => sum + t.capitulos.length, 0);

    await guardarEnGitHub(`${tmdb_id}_capitulos.json`, datos);
    await guardarEnFirebase(tmdb_id.toString(), datos);

    res.json({ success: true, message: 'Capítulo eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/novela/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;

    if (firebaseInicializado) {
      await db.ref(`novelas/${tmdbId}`).remove();
    }

    try {
      const { data: file } = await octokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: `${tmdbId}_capitulos.json`,
        branch: GITHUB_BRANCH
      });

      await octokit.repos.deleteFile({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: `${tmdbId}_capitulos.json`,
        message: `Eliminar ${tmdbId}`,
        sha: file.sha,
        branch: GITHUB_BRANCH
      });
    } catch (e) {
      console.log('Archivo no existe en GitHub');
    }

    res.json({ success: true, message: 'Novela eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/novela/:tmdbId', async (req, res) => {
  try {
    const datos = await leerDeFirebase(req.params.tmdbId);

    if (!datos) {
      const datosGitHub = await leerDeGitHub(`${req.params.tmdbId}_capitulos.json`);
      if (datosGitHub) return res.json(datosGitHub);
      return res.status(404).json({ error: 'No encontrada' });
    }

    res.json(datos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENDPOINT CARGAR ESTRUCTURA DESDE TMDB
// ============================================
app.post('/api/admin/cargar-estructura-tmdb', async (req, res) => {
  const { tmdb_id } = req.body;

  if (!tmdb_id) {
    return res.status(400).json({ error: 'Se requiere tmdb_id' });
  }

  console.log(`\n📥 Cargando estructura de TMDB para ID: ${tmdb_id}`);

  try {
    const tvUrl = `https://api.themoviedb.org/3/tv/${tmdb_id}?api_key=${TMDB_API_KEY}&language=es`;
    const tvResponse = await axios.get(tvUrl);
    const tvData = tvResponse.data;

    console.log(`📺 Serie: ${tvData.name}`);
    console.log(`📊 Temporadas: ${tvData.number_of_seasons}`);

    // ✅ OBJETO CON CLAVES "temp_X" (evita conversión a array en Firebase)
    const temporadas = {};

    for (const season of tvData.seasons || []) {
      if (season.season_number === 0) continue;

      console.log(`  📂 Cargando temporada ${season.season_number}...`);

      try {
        const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdb_id}/season/${season.season_number}?api_key=${TMDB_API_KEY}&language=es`;
        const seasonResponse = await axios.get(seasonUrl);
        const seasonData = seasonResponse.data;

        const capitulos = (seasonData.episodes || []).map(ep => ({
          numero: ep.episode_number,
          titulo: ep.name || `Capítulo ${ep.episode_number}`,
          url: '',
          servidores: []
        }));

        temporadas[`temp_${season.season_number}`] = {
          numero: season.season_number,
          titulo: seasonData.name || `Temporada ${season.season_number}`,
          fecha_extraccion: new Date().toISOString(),
          total_capitulos: capitulos.length,
          capitulos: capitulos
        };

        console.log(`    ✅ ${capitulos.length} capítulos`);
        await new Promise(r => setTimeout(r, 200));

      } catch (seasonError) {
        console.error(`    ❌ Error en temporada ${season.season_number}:`, seasonError.message);
      }
    }

    const totalTemporadas = Object.keys(temporadas).length;
    const totalCapitulos = Object.values(temporadas)
      .reduce((sum, t) => sum + t.total_capitulos, 0);

    const datos = {
      novela: tvData.name,
      tmdb_id: parseInt(tmdb_id),
      poster: tvData.poster_path ? `${TMDB_IMAGE_BASE}${tvData.poster_path}` : null,
      url: null,
      temporadas: temporadas,
      total_temporadas: totalTemporadas,
      total_capitulos: totalCapitulos,
      fecha_creacion: new Date().toISOString(),
      fecha_actualizacion: new Date().toISOString()
    };

    await guardarEnGitHub(`${tmdb_id}_capitulos.json`, datos);
    await guardarEnFirebase(tmdb_id.toString(), datos);

    console.log(`✅ Estructura guardada: ${totalTemporadas} temporadas, ${totalCapitulos} capítulos`);

    res.json({
      success: true,
      message: `Estructura cargada: ${totalTemporadas} temporadas, ${totalCapitulos} capítulos`,
      data: datos
    });

  } catch (error) {
    console.error('❌ Error cargando estructura:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENDPOINTS PÚBLICOS
// ============================================
app.get('/api/novelas', async (req, res) => {
  try {
    const novelas = [];
    const novelasFirebase = await listarNovelasFirebase();

    if (novelasFirebase.length > 0) {
      for (const n of novelasFirebase) {
        novelas.push({
          id: n.tmdb_id || n.id,
          nombre: n.novela,
          total_capitulos: n.total_capitulos || 0,
          total_temporadas: n.total_temporadas || 0,
          fecha: n.fecha_actualizacion || n.fecha_extraccion || n.fecha_creacion,
          poster: n.poster || null
        });
      }
    } else {
      const files = await listarArchivosGitHub();
      for (const file of files) {
        const data = await leerDeGitHub(file.name);
        if (data) {
          novelas.push({
            id: file.name.replace('_capitulos.json', ''),
            nombre: data.novela,
            total_capitulos: data.total_capitulos || 0,
            total_temporadas: data.total_temporadas || 0,
            fecha: data.fecha_actualizacion || data.fecha_extraccion,
            poster: data.poster || null
          });
        }
      }
    }

    res.json(novelas);
  } catch (error) {
    console.error('Error:', error.message);
    res.json([]);
  }
});

// ✅ ENDPOINT CORREGIDO: devuelve la estructura completa
app.get('/api/novela/:id/capitulos', async (req, res) => {
  try {
    let data = await leerDeFirebase(req.params.id);

    if (!data) {
      data = await leerDeGitHub(`${req.params.id}_capitulos.json`);
    }

    if (!data) {
      return res.status(404).json({ error: 'Novela no encontrada' });
    }

    // ✅ Devolver la estructura completa (con temporadas o capítulos)
    res.json(data);

  } catch (error) {
    console.error('Error al cargar capítulos:', error.message);
    res.status(500).json({ error: 'Error al cargar' });
  }
});

// ============================================
// BUSCAR NOVELAS
// ============================================
app.post('/api/buscar', async (req, res) => {
  const { titulo } = req.body;
  if (!titulo) return res.status(400).json({ error: 'Se requiere título' });

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
          resultados.push({ titulo: texto, url: urlCompleta });
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

// ============================================
// SCRAPING
// ============================================
app.post('/api/scrape', async (req, res) => {
  const { url, nombre, limite, tmdb_id } = req.body;

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
    // Poster
    let tmdb_poster = null;
    try {
      const tvUrl = `https://api.themoviedb.org/3/tv/${tmdbIdFinal}?api_key=${TMDB_API_KEY}&language=es`;
      const tvResponse = await axios.get(tvUrl);
      if (tvResponse.data && tvResponse.data.poster_path) {
        tmdb_poster = `${TMDB_IMAGE_BASE}${tvResponse.data.poster_path}`;
      }
    } catch (error) {
      try {
        const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbIdFinal}?api_key=${TMDB_API_KEY}&language=es`;
        const movieResponse = await axios.get(movieUrl);
        if (movieResponse.data && movieResponse.data.poster_path) {
          tmdb_poster = `${TMDB_IMAGE_BASE}${movieResponse.data.poster_path}`;
        }
      } catch (e) {}
    }

    // Leer datos existentes
    let datosExistentes = await leerDeFirebase(tmdbIdFinal.toString());

    if (!datosExistentes) {
      datosExistentes = {
        novela: nombre.replace(/\s+\d+\s*$/, '').trim(),
        tmdb_id: tmdbIdFinal,
        poster: tmdb_poster,
        temporadas: {}
      };
    }

    if (!datosExistentes.temporadas) {
      datosExistentes.temporadas = {};
    }

    // Obtener capítulos
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
            if (esServidorVideo(u)) servidores.add(u);
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
        resultados.push({
          numero: cap.numero,
          error: error.message,
          servidores: []
        });
      }

      await new Promise(r => setTimeout(r, 500));
    }

    // ✅ CLAVE CON PREFIJO "temp_"
    datosExistentes.temporadas[`temp_${temporada}`] = {
      numero: parseInt(temporada),
      titulo: nombre,
      fecha_extraccion: new Date().toISOString(),
      total_capitulos: resultados.length,
      url: url,
      capitulos: resultados
    };

    if (tmdb_poster) datosExistentes.poster = tmdb_poster;

    datosExistentes.total_temporadas = Object.keys(datosExistentes.temporadas).length;
    datosExistentes.total_capitulos = Object.values(datosExistentes.temporadas)
      .reduce((sum, t) => sum + (t.total_capitulos || 0), 0);

    await guardarEnGitHub(`${tmdbIdFinal}_capitulos.json`, datosExistentes);
    await guardarEnFirebase(tmdbIdFinal.toString(), datosExistentes);

    console.log(`✅ Scraping completado: ${resultados.length} capítulos guardados`);

    res.json({
      success: true,
      message: `Temporada ${temporada} agregada correctamente`,
      tmdb_id: tmdbIdFinal,
      temporada: temporada,
      total_temporadas: datosExistentes.total_temporadas,
      total_capitulos: datosExistentes.total_capitulos
    });

  } catch (error) {
    console.error('❌ Error en scraping:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// RUTA PRINCIPAL
// ============================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend.html'));
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`✅ Servidor funcionando correctamente`);
  console.log(`📡 Puerto: ${PORT}`);
  console.log(`🌐 Accede a: http://localhost:${PORT}`);
  console.log(`========================================\n`);
});