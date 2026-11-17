const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = './data';

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Función auxiliar para leer un JSON
async function leerJSON(nombreArchivo) {
    try {
        const data = await fs.readFile(path.join(DATA_DIR, nombreArchivo), 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

// 1. Listar novelas para la biblioteca
app.get('/api/novelas', async (req, res) => {
    try {
        const files = await fs.readdir(DATA_DIR);
        const novelas = [];

        for (const file of files) {
            if (file.endsWith('_capitulos.json')) {
                const data = await leerJSON(file);
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
        res.json(novelas);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Obtener capítulos (Adaptado al formato que espera tu frontend)
app.get('/api/novela/:id/capitulos', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await leerJSON(`${id}_capitulos.json`);
        
        if (!data) return res.status(404).json({ error: 'No encontrada' });

        // Tu frontend espera un objeto "temporadas". 
        // Como el JSON del scraper trae "capitulos" en plano, lo convertimos:
        const respuestaFormateada = {
            novela: data.novela,
            total_temporadas: 1,
            total_capitulos: data.total_capitulos,
            temporadas: {
                "temp_1": {
                    numero: 1,
                    titulo: "Temporada 1",
                    total_capitulos: data.total_capitulos,
                    capitulos: data.capitulos // Aquí van los capítulos con sus servidores
                }
            }
        };

        res.json(respuestaFormateada);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend.html'));
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`✅ Servidor listo en http://localhost:${PORT}`);
    console.log(`========================================\n`);
});